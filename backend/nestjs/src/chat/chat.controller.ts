import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as express from 'express';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateAiAvatarDto } from './dto/update-ai-avatar.dto';
import { UpdateModelDto } from './dto/update-model.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { User } from '../entities/user.entity';

/** 会话 AI 头像大小上限（与 R2 头像策略一致：5MB） */
const AI_AVATAR_MAX_SIZE = 5 * 1024 * 1024;
/** 聊天附件大小上限（与 Python 网关的音频 20MB 上限一致） */
const ATTACHMENT_MAX_SIZE = 20 * 1024 * 1024;

/**
 * 对话接口（全局守卫拦截，所有接口均需登录）
 * 数据按当前登录用户隔离，互不可见
 */
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // POST /chat/stream  { conversationId?, content }
  // 流式对话：服务端保存用户消息 → 代理 Python AI 流式回复 → 保存 AI 回复
  // SSE 事件：data: {conversation_id, title} → data: {chunk}* → data: [DONE]
  @Post('stream')
  async stream(
    @Body() dto: SendMessageDto,
    @CurrentUser() user: User,
    @Res() res: express.Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 客户端断开连接时中止对上游 Python 的转发
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    try {
      for await (const payload of this.chatService.stream(
        dto,
        user,
        abort.signal,
      )) {
        res.write(payload);
      }
    } catch (e) {
      res.write(
        `data: ${JSON.stringify({ error: (e as Error).message })}\n\n`,
      );
    } finally {
      res.end();
    }
  }

  // POST /chat/internal/image  { prompt, image_url? }
  // 供 Python Agent 的 generate_image / edit_image 工具回调：服务间调用，用 x-internal-token 鉴权（非用户 JWT）
  // 不带 image_url → 文生图；带 image_url → 基于该图改图。结果落 R2，返回 { url }
  @Public()
  @Post('internal/image')
  async internalImage(
    @Body() body: { prompt?: string; image_url?: string },
    @Headers('x-internal-token') token?: string,
  ) {
    const url = await this.chatService.generateImageByPrompt(
      body?.prompt ?? '',
      token,
      body?.image_url,
    );
    return { url };
  }

  // GET /chat/models  模型清单（含多模态能力声明，前端据此门控附件功能）
  @Get('models')
  listModels() {
    return this.chatService.listModels();
  }

  // POST /chat/attachments  上传聊天附件（form-data，字段名 file）
  // 返回 { type, url, key, name, mime, size, text? }，text 为文档类附件的提取内容
  @Post('attachments')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_SIZE } }),
  )
  uploadAttachment(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    return this.chatService.uploadAttachment(user, file);
  }

  // GET /chat/conversations  会话列表
  @Get('conversations')
  listConversations(@CurrentUser() user: User) {
    return this.chatService.listConversations(user.id);
  }

  // GET /chat/conversations/:id/messages  会话内全部消息
  @Get('conversations/:id/messages')
  listMessages(@CurrentUser() user: User, @Param('id') id: string) {
    return this.chatService.listMessages(user.id, id);
  }

  // DELETE /chat/conversations/:id  删除会话（连带消息）
  @Delete('conversations/:id')
  deleteConversation(@CurrentUser() user: User, @Param('id') id: string) {
    return this.chatService.deleteConversation(user.id, id);
  }

  // POST /chat/conversations/:id/ai-avatar  上传本会话专属 AI 头像（form-data，字段名 file）
  @Post('conversations/:id/ai-avatar')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AI_AVATAR_MAX_SIZE } }),
  )
  uploadAiAvatar(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.chatService.uploadAiAvatar(user.id, id, file);
  }

  // PATCH /chat/conversations/:id/ai-avatar  { aiAvatar: null } 清除专属头像，回退全局默认
  @Patch('conversations/:id/ai-avatar')
  setAiAvatar(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateAiAvatarDto,
  ) {
    return this.chatService.setAiAvatar(user.id, id, dto.aiAvatar ?? null);
  }

  // PATCH /chat/conversations/:id/model  { model: "mimo-v2.5" | null } 切换会话模型
  @Patch('conversations/:id/model')
  setModel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateModelDto,
  ) {
    return this.chatService.setModel(user.id, id, dto.model ?? null);
  }
}