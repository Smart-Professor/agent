
import * as path from 'path';
import { Agent } from 'undici';
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import {
  ChatConversation,
  ChatMessage,
  MessageAttachment,
} from '../entities/chat.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { R2Service } from '../r2/r2.service';

/** 把对象序列化为一条 SSE 事件文本 */
const sse = (payload: Record<string, unknown>): string =>
  `data: ${JSON.stringify(payload)}\n\n`;

/** 会话级 AI 头像在 R2 的前缀（与 r2.controller.ts 中约定一致） */
const AI_AVATAR_PREFIX = 'ai-avatars/';
/** 聊天附件在 R2 的前缀（按类型分目录，仅登录用户可上传） */
const CHAT_ATTACHMENT_PREFIX = 'chat-attachments/';
/** 头像图片 MIME 白名单与大小上限（与 r2.controller.ts 保持一致） */
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5MB
/** 附件大小上限：20MB（音频转 base64 后有膨胀，上限与 Python 网关一致） */
const ATTACHMENT_MAX_SIZE = 20 * 1024 * 1024;
/** 文档附件提取文本的上限，超出截断，防止撑爆模型上下文 */
const FILE_TEXT_MAX_CHARS = 20000;
/** 文生图调用上游的最大尝试次数（网络抖动/5xx 时重试） */
const IMAGE_GEN_MAX_RETRIES = 3;
/**
 * 图片服务（apinebula，OpenAI Images 兼容）专用连接池。
 * undici 默认 connectTimeout=10s 偏短；改图实测单次可达 70s+，
 * 首字节与整体读取超时都放宽到 300s。
 */
const imageDispatcher = new Agent({
  connectTimeout: 30_000,
  headersTimeout: 300_000,
  bodyTimeout: 300_000,
});
/** 视为"音频"的 MIME 前缀与扩展名 */
const AUDIO_MIMES = ['audio/', 'application/ogg'];
const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.opus'];
/** 可按文本提取内容的文档扩展名（代码 / 文档 / 数据文件） */
const TEXT_FILE_EXTS = [
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.html', '.htm',
  '.css', '.scss', '.less', '.xml', '.yml', '.yaml', '.toml', '.ini',
  '.py', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs',
  '.rb', '.php', '.sql', '.sh', '.bat', '.ps1', '.conf', '.env', '.lock',
];

/** 会话列表项（含消息数统计与会话专属 AI 头像） */
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  /** 会话专属 AI 头像 URL；为空时前端回退用户全局默认 */
  aiAvatar: string | null;
}

/**
 * 对话业务服务
 * - 会话 / 消息持久化到 PostgreSQL（按 userId 隔离，互不可见）
 * - 流式生成：代理下游 Python Agent 的 SSE，边转发边落库
 */
@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly convRepo: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly msgRepo: Repository<ChatMessage>,
    private readonly config: ConfigService,
    private readonly r2Service: R2Service,
  ) {}

  /** 代理 Python Agent 的 SSE，转发给前端并同时把 AI 回复写入数据库 */
  async *stream(
    dto: SendMessageDto,
    user: User,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const content = dto.content.trim();

    // 1. 会话：有 conversationId 则校验归属，否则新建
    let conv = dto.conversationId
      ? await this.convRepo.findOne({
          where: { id: dto.conversationId, userId: user.id },
        })
      : null;
    if (dto.conversationId && !conv) {
      throw new NotFoundException('会话不存在或无权访问');
    }
    if (!conv) {
      conv = this.convRepo.create({
        userId: user.id,
        title: content.slice(0, 24) || '新对话',
        // 新会话直接带上用户选择的模型；未选时为 null，Python 侧用默认模型
        model: dto.model ?? null,
      });
      await this.convRepo.save(conv);
    } else if (dto.model && dto.model !== conv.model) {
      // 既有会话：本次发送选择的模型会话内生效并持久化
      conv.model = dto.model;
      await this.convRepo.update(conv.id, { model: conv.model });
    }

    // 2. 用户消息立即入库（保留实体，查历史时需排除这条；附件一并落库）
    const savedUserMsg = await this.msgRepo.save(
      this.msgRepo.create({
        conversationId: conv.id,
        role: 'user',
        content,
        attachments: (dto.attachments?.length ? dto.attachments : null) as
          | MessageAttachment[]
          | null,
      }),
    );

    // 3. 元事件：告知前端真实会话 ID（新建会话时需要）
    yield sse({ conversation_id: conv.id, title: conv.title });

    // 4. 读取最近的历史消息（排除刚入库的这条：本次内容已通过 prompt 单独传递，
    //    否则模型会看到两遍相同消息），供 AI 感知上下文；附件随历史一并回传
    const historyRows = await this.msgRepo
      .createQueryBuilder('m')
      .where('m.conversationId = :id', { id: conv.id })
      .andWhere('m.id != :excludeId', { excludeId: savedUserMsg.id })
      .orderBy('m."createdAt"', 'DESC')
      .take(20) // 最近 20 条（约 10 轮对话），防止超长上下文
      .getMany();
    const history = historyRows
      .reverse() // 恢复时间正序
      .map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments ?? undefined,
      }));

    // 5. 调用下游 Python Agent 的流式接口
    const base =
      this.config.get<string>('PYTHON_AGENT_URL') ?? 'http://localhost:18000';
    const upstream = await fetch(`${base}/agent/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: content,
        // Agent 模式透传：character_design 时 Python 侧走角色设计专用 Agent
        mode: dto.mode,
        max_completion_tokens: 4096,
        // 会话已保存的模型优先，其次本次请求显式指定，最后 Python 用默认
        model: conv.model ?? dto.model ?? undefined,
        // 历史消息（含刚才这条 user 消息之前的所有轮次）
        history,
        // 本次消息的多模态附件（图片/文档/音频），由 Python 网关组装内容块
        attachments: dto.attachments?.length ? dto.attachments : undefined,
      }),
      signal,
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      throw new BadGatewayException(
        `AI 服务调用失败：${detail || upstream.status}`,
      );
    }

    // 5. 逐段转发，同时累积完整回复；模型通过工具生成的图片收集为 AI 消息附件
    let full = '';
    const imageAtts: MessageAttachment[] = [];
    try {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            let obj: Record<string, unknown>;
            try {
              obj = JSON.parse(data);
            } catch {
              continue;
            }
            if (obj.error) throw new Error(String(obj.error));
            // 思考过程实时透传给前端展示，不累积进正文、不入库
            if (typeof obj.thinking === 'string') {
              yield sse({ thinking: obj.thinking });
              continue;
            }
            // 生图进行中的状态提示：仅透传展示，不入库
            if (typeof obj.image_status === 'string') {
              yield sse({ image_status: obj.image_status });
              continue;
            }
            // 模型调用 generate_image 工具产出的图片：收集为附件（随 AI 消息落库）并透传
            if (typeof obj.image === 'string') {
              imageAtts.push({ type: 'image', url: obj.image, mime: 'image/jpeg' });
              yield sse({ image: obj.image });
              continue;
            }
            if (typeof obj.chunk === 'string') {
              full += obj.chunk;
              yield sse({ chunk: obj.chunk });
            }
          }
        }
      }
    } catch (e) {
      // 客户端断开（AbortError）或上游报错：已生成的部分内容/图片同样入库
      if (full || imageAtts.length) {
        await this.saveAssistantMessage(conv.id, full, imageAtts);
      }
      if ((e as Error).name === 'AbortError') {
        yield sse({ aborted: true });
        return;
      }
      yield sse({ error: (e as Error).message });
      return;
    }

    await this.saveAssistantMessage(conv.id, full, imageAtts);
    yield 'data: [DONE]\n\n';
  }

  /** 保存 AI 回复并刷新会话的 updatedAt（侧边栏排序用）；支持带附件（如文生图结果） */
  private async saveAssistantMessage(
    conversationId: string,
    content: string,
    attachments?: MessageAttachment[] | null,
  ): Promise<void> {
    await this.msgRepo.save(
      this.msgRepo.create({
        conversationId,
        role: 'assistant',
        content,
        attachments: attachments?.length ? attachments : null,
      }),
    );
    await this.convRepo.update(conversationId, { updatedAt: new Date() });
  }

  /**
   * 上传聊天附件（图片 / 文档 / 音频）到 R2，返回可直接随消息发送的附件对象。
   * - 图片：image/* → chat-attachments/images/
   * - 音频：audio/* 等 → chat-attachments/audio/
   * - 文档：其余文件 → chat-attachments/files/，文本类文件自动提取内容（attachment.text）
   */
  async uploadAttachment(
    user: User,
    file: Express.Multer.File,
  ): Promise<MessageAttachment & { key: string }> {
    if (!file) throw new BadRequestException('请选择文件');
    if (file.size > ATTACHMENT_MAX_SIZE) {
      throw new BadRequestException('附件大小不能超过 20MB');
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype || 'application/octet-stream';

    let type: MessageAttachment['type'];
    let subDir: string;
    if (IMAGE_MIMES.includes(mime)) {
      type = 'image';
      subDir = 'images';
    } else if (
      AUDIO_MIMES.some((p) => mime.startsWith(p)) ||
      AUDIO_EXTS.includes(ext)
    ) {
      type = 'audio';
      subDir = 'audio';
    } else {
      type = 'file';
      subDir = 'files';
    }

    const safeName = path
      .basename(file.originalname)
      .replace(/[^\w.\u4e00-\u9fa5-]/g, '_');
    const key = `${CHAT_ATTACHMENT_PREFIX}${subDir}/${user.id}/${Date.now()}-${safeName}`;
    const url = await this.r2Service.upload(key, file.buffer, mime);

    // 文本类文档：提取内容作为模型上下文（音频/图片由多模态模型直接理解）
    let text: string | undefined;
    if (type === 'file' && (mime.startsWith('text/') || TEXT_FILE_EXTS.includes(ext))) {
      text = file.buffer.toString('utf8').slice(0, FILE_TEXT_MAX_CHARS);
    }

    return { type, url, key, name: file.originalname, mime, size: file.size, text };
  }

  /** 代理 Python Agent 的模型清单（含多模态能力声明）；Python 不可用时回退内置清单 */
  async listModels(): Promise<{ models: unknown[]; default: string; fallback: boolean }> {
    const base =
      this.config.get<string>('PYTHON_AGENT_URL') ?? 'http://localhost:18000';
    try {
      const resp = await fetch(`${base}/agent/models`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(String(resp.status));
      return { ...(await resp.json()), fallback: false };
    } catch {
      // Python 未启动时回退到与注册表一致的静态清单，保证前端模型下拉可用
      return {
        models: [
          { id: 'mimo-v2.5', label: 'MiMo v2.5（默认 · 响应快）', capabilities: { vision: true, audio: false } },
          { id: 'mimo-v2.5-pro', label: 'MiMo v2.5 Pro（深度推理 · 较慢）', capabilities: { vision: true, audio: false } },
          { id: 'GLM-5.3-Flash', label: 'GLM-5.3 Flash（便宜快速 · 开发推荐）', capabilities: { vision: true, audio: false } },
        ],
        default: 'mimo-v2.5',
        fallback: true,
      };
    }
  }

  /**
   * 供 Python Agent 的 generate_image / edit_image 工具回调：
   * 校验内部共享密钥后按是否带 image_url 分流到「生图」或「改图」。
   * 不走用户 JWT（服务间调用），改用 x-internal-token 鉴权。
   */
  async generateImageByPrompt(
    prompt: string,
    internalToken?: string,
    imageUrl?: string,
  ): Promise<string> {
    const expected = this.config.get<string>('INTERNAL_TOKEN');
    if (!expected || internalToken !== expected) {
      throw new ForbiddenException('内部接口鉴权失败');
    }
    const p = (prompt ?? '').trim();
    if (!p) throw new BadRequestException('prompt 不能为空');
    if (p.length > 2000) throw new BadRequestException('prompt 过长（最多 2000 字）');
    const src = (imageUrl ?? '').trim();
    if (src) {
      if (!/^https?:\/\//i.test(src)) {
        throw new BadRequestException('image_url 必须是 http(s) 地址');
      }
      return this.modifyImage(src, p.slice(0, 2000));
    }
    return this.generateImage(p.slice(0, 2000));
  }

  /** 图片服务鉴权头与默认模型（生成/改图共用同一把 key，模型可分别覆盖） */
  private imageApiAuth(): { apiKey: string; genModel: string; editModel: string } {
    const apiKey =
      this.config.get<string>('IMAGE_GEN_API_KEY') ??
      this.config.get<string>('IMAGE_MODIFY_API_KEY');
    if (!apiKey) {
      throw new BadGatewayException(
        '未配置图片服务密钥：请在 backend/nestjs/.env 中设置 IMAGE_MODIFY_API_KEY',
      );
    }
    const editModel = this.config.get<string>('IMAGE_MODIFY') ?? 'gpt-image-1';
    const genModel = this.config.get<string>('IMAGE_GEN_MODEL') ?? editModel;
    return { apiKey, genModel, editModel };
  }

  /** 带重试的图片服务请求：网络错误/5xx 重试，4xx 直接抛出上游错误信息 */
  private async fetchImageApi(
    url: string,
    init: RequestInit,
    retries = IMAGE_GEN_MAX_RETRIES,
  ): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(url, {
          ...init,
          dispatcher: imageDispatcher,
        } as RequestInit & { dispatcher: typeof imageDispatcher });
        if (resp.ok) return resp;
        if (resp.status < 500) {
          const body = await resp.text().catch(() => '');
          throw new BadGatewayException(
            `图片服务返回 ${resp.status}：${body.slice(0, 200)}`,
          );
        }
        lastErr = new Error(`上游返回 ${resp.status}`);
      } catch (e) {
        if (e instanceof BadGatewayException) throw e;
        lastErr = e;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    throw new BadGatewayException(
      `图片服务暂时不可用（已重试 ${retries} 次）：${(lastErr as Error)?.message ?? lastErr}`,
    );
  }

  /** 解析图片服务响应：优先 b64_json（gpt-image 系只回 b64），兼容 url 字段，返回图片字节 */
  private async readImageBytes(resp: Response): Promise<Buffer> {
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return Buffer.from(await resp.arrayBuffer());
    }
    const data = (await resp.json().catch(() => null)) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    } | null;
    const item = data?.data?.[0];
    if (item?.b64_json) {
      return Buffer.from(item.b64_json, 'base64');
    }
    if (item?.url) {
      const r = await this.fetchImageApi(
        item.url,
        { signal: AbortSignal.timeout(120_000) },
        2,
      );
      return Buffer.from(await r.arrayBuffer());
    }
    throw new BadGatewayException('图片服务响应中缺少图片数据');
  }

  /** 把图片字节上传 R2，返回公开 URL */
  private async uploadGenerated(buf: Buffer): Promise<string> {
    const key = `${CHAT_ATTACHMENT_PREFIX}generated/${Date.now()}.png`;
    return this.r2Service.upload(key, buf, 'image/png');
  }

  /**
   * 文生图：POST JSON 到 IMAGE_GEN_URL（OpenAI Images 兼容）。
   * 结果落 R2 后返回公开 URL；网络错误/5xx 自动重试。
   */
  private async generateImage(prompt: string): Promise<string> {
    const endpoint = this.config.get<string>('IMAGE_GEN_URL');
    if (!endpoint) {
      throw new BadGatewayException(
        '未配置图片生成服务：请在 backend/nestjs/.env 中设置 IMAGE_GEN_URL',
      );
    }
    const { apiKey, genModel } = this.imageApiAuth();
    const resp = await this.fetchImageApi(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: genModel,
        prompt: prompt.slice(0, 2000),
        n: 1,
        size: '1024x1024',
      }),
      // 改图实测 70s+，整体超时放宽到 5 分钟
      signal: AbortSignal.timeout(300_000),
    });
    return this.uploadGenerated(await this.readImageBytes(resp));
  }

  /**
   * 改图：下载源图后以 multipart 上传到 IMAGE_MODIFY_URL（OpenAI Images edits 兼容）。
   * 结果落 R2 后返回公开 URL。
   */
  private async modifyImage(imageUrl: string, prompt: string): Promise<string> {
    const endpoint = this.config.get<string>('IMAGE_MODIFY_URL');
    if (!endpoint) {
      throw new BadGatewayException(
        '未配置改图服务：请在 backend/nestjs/.env 中设置 IMAGE_MODIFY_URL',
      );
    }
    const { apiKey, editModel } = this.imageApiAuth();

    // 下载源图（用户上传的 R2 公开 URL 或其他可访问地址）
    const srcResp = await this.fetchImageApi(
      imageUrl,
      { signal: AbortSignal.timeout(60_000) },
      2,
    );
    const srcBuf = Buffer.from(await srcResp.arrayBuffer());
    const srcMime =
      srcResp.headers.get('content-type')?.split(';')[0] || 'image/png';
    const ext = srcMime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';

    const form = new FormData();
    form.append('model', editModel);
    form.append('prompt', prompt.slice(0, 2000));
    form.append('size', '1024x1024');
    form.append(
      'image',
      new Blob([new Uint8Array(srcBuf)], { type: srcMime }),
      `image.${ext}`,
    );

    const resp = await this.fetchImageApi(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
    return this.uploadGenerated(await this.readImageBytes(resp));
  }

  /** 当前用户的会话列表（按最近更新排序，含消息数） */
  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.convRepo
      .createQueryBuilder('c')
      .leftJoin(ChatMessage, 'm', 'm.conversationId = c.id')
      .where('c.userId = :userId', { userId })
      .select([
        'c.id AS id',
        'c.title AS title',
        'c."createdAt" AS "createdAt"',
        'c."updatedAt" AS "updatedAt"',
        'c."aiAvatar" AS "aiAvatar"',
        'c."model" AS "model"',
      ])
      .addSelect('COUNT(m.id)', 'messageCount')
      .groupBy('c.id')
      .orderBy('c."updatedAt"', 'DESC')
      .getRawMany<{
        id: string;
        title: string;
        createdAt: Date;
        updatedAt: Date;
        messageCount: string;
        aiAvatar: string | null;
        model: string | null;
      }>();

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      messageCount: Number(r.messageCount),
      aiAvatar: r.aiAvatar ?? null,
      model: r.model ?? null,
    }));
  }

  /** 会话内的消息（按时间正序），校验会话归属 */
  async listMessages(userId: string, conversationId: string) {
    const conv = await this.convRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conv) throw new NotFoundException('会话不存在或无权访问');
    return this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  /** 删除会话及其全部消息（校验归属，事务保证原子性），并清理 R2 上的会话专属头像 */
  async deleteConversation(userId: string, conversationId: string) {
    const conv = await this.convRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conv) throw new NotFoundException('会话不存在或无权访问');

    // 事务删除：消息与会话要么全部删除成功，要么全部保留，避免留下孤儿数据
    await this.convRepo.manager.transaction(async (em) => {
      await em.delete(ChatMessage, { conversationId });
      await em.delete(ChatConversation, { id: conversationId });
    });

    // 数据库删除成功后再清理 R2 头像文件（失败不影响删除结果，仅记录日志）
    if (conv.aiAvatar) {
      const key = this.r2KeyFromUrl(conv.aiAvatar);
      if (key) {
        try {
          await this.r2Service.delete(key);
        } catch (e) {
          console.warn(
            `删除会话头像失败（key=${key}）: ${(e as Error).message}`,
          );
        }
      }
    }

    return { message: '删除成功', id: conversationId };
  }

  /** 从头像公开 URL 反推 R2 对象 key（URL 中包含 ai-avatars/ 前缀起算） */
  private r2KeyFromUrl(url: string): string | null {
    const idx = url.indexOf(AI_AVATAR_PREFIX);
    return idx >= 0 ? url.slice(idx) : null;
  }

  /** 设置/清除会话使用模型（null 表示回退默认模型），校验归属 */
  async setModel(
    userId: string,
    conversationId: string,
    model: string | null,
  ): Promise<{ id: string; model: string | null }> {
    const conv = await this.convRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conv) throw new NotFoundException('会话不存在或无权访问');
    const normalized = model?.trim() || null;
    await this.convRepo.update(conversationId, { model: normalized });
    return { id: conversationId, model: normalized };
  }

  /** 设置/清除会话专属 AI 头像（null 表示跟随用户全局默认），校验归属 */
  async setAiAvatar(
    userId: string,
    conversationId: string,
    aiAvatar: string | null,
  ): Promise<{ id: string; aiAvatar: string | null }> {
    const conv = await this.convRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conv) throw new NotFoundException('会话不存在或无权访问');
    await this.convRepo.update(conversationId, { aiAvatar });
    return { id: conversationId, aiAvatar };
  }

  /** 上传会话专属 AI 头像到 R2 并写回会话，校验图片类型/大小与归属 */
  async uploadAiAvatar(
    userId: string,
    conversationId: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; key: string; id: string }> {
    const conv = await this.convRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conv) throw new NotFoundException('会话不存在或无权访问');
    if (!file) throw new BadRequestException('请选择图片');
    if (!IMAGE_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('头像仅支持 png / jpg / gif / webp 图片');
    }
    if (file.size > AVATAR_MAX_SIZE) {
      throw new BadRequestException('头像大小不能超过 5MB');
    }
    const ext = path.extname(file.originalname) || '.png';
    const key = `${AI_AVATAR_PREFIX}${userId}/conv-${conversationId}-${Date.now()}${ext}`;
    const url = await this.r2Service.upload(key, file.buffer, file.mimetype);
    await this.convRepo.update(conversationId, { aiAvatar: url });
    return { url, key, id: conversationId };
  }
}