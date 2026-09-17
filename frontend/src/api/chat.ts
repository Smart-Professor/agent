/**
 * 对话接口封装（NestJS 后端）
 * - 会话 / 消息持久化；流式接口由 NestJS 代理 Python AI 服务
 */
import http, { getToken } from './http'

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  aiAvatar?: string | null
  /** 会话使用的模型 ID；为空表示后端默认模型 */
  model?: string | null
}

export interface ChatMessageRecord {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** 多模态附件（图片/文档/音频），无附件时为 null */
  attachments?: MessageAttachment[] | null
}

/** 消息附件：图片 / 文档 / 音频（URL 指向 R2） */
export interface MessageAttachment {
  type: 'image' | 'file' | 'audio'
  url: string
  name?: string
  mime?: string
  size?: number
  /** 文档附件的服务端提取文本（发给模型做上下文，前端不展示） */
  text?: string
}

/** 模型信息（含多模态能力声明，来自后端 /chat/models → Python /agent/models） */
export interface ModelInfo {
  id: string
  label: string
  capabilities: {
    /** 图片理解 */
    vision: boolean
    /** 语音/音频理解 */
    audio: boolean
  }
}

/** 会话列表（按最近更新排序） */
export async function listConversations(): Promise<ConversationSummary[]> {
  const { data } = await http.get('/chat/conversations')
  return data as ConversationSummary[]
}

/** 会话内全部消息（按时间正序） */
export async function listMessages(id: string): Promise<ChatMessageRecord[]> {
  const { data } = await http.get(`/chat/conversations/${id}/messages`)
  return data as ChatMessageRecord[]
}

/** 删除会话（连带消息） */
export async function deleteConversation(id: string): Promise<void> {
  await http.delete(`/chat/conversations/${id}`)
}

/** 上传会话专属 AI 头像（返回新头像 URL，后端同步写回会话） */
export async function uploadConversationAiAvatar(
  id: string,
  file: File,
): Promise<{ url: string; key: string; id: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const { data } = await http.post(`/chat/conversations/${id}/ai-avatar`, fd)
  return data
}

/** 清除会话专属 AI 头像，回退到用户全局默认 */
export async function resetConversationAiAvatar(id: string): Promise<void> {
  await http.patch(`/chat/conversations/${id}/ai-avatar`, { aiAvatar: null })
}

/** 切换会话使用的模型（传 null 回退默认模型） */
export async function setConversationModel(id: string, model: string | null): Promise<void> {
  await http.patch(`/chat/conversations/${id}/model`, { model })
}

/** 模型清单（含多模态能力声明）；Python 不可用時后端回退内置清单 */
export async function listModels(): Promise<{ models: ModelInfo[]; default: string; fallback: boolean }> {
  const { data } = await http.get('/chat/models')
  return data
}

/** 上传聊天附件（图片/文档/音频），返回可直接随消息发送的附件对象 */
export async function uploadAttachment(
  file: File,
): Promise<MessageAttachment & { key: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const { data } = await http.post('/chat/attachments', fd)
  return data
}

export interface StreamMeta {
  conversation_id?: string
  title?: string
}

export interface StreamCallbacks {
  /** 首条元事件：新建会话时后端返回真实会话 ID */
  onMeta?: (meta: StreamMeta) => void
  /** 每收到一段模型思考过程（正文开始前到达，用于"思考中"实时展示） */
  onThinking?: (chunk: string) => void
  /** 每收到一段正文 */
  onChunk: (chunk: string) => void
  /** 模型调用生图工具：后端推送生成图片的 URL（消息中也会落库） */
  onImage?: (url: string) => void
  /** 生图工具执行中的状态提示（如"正在生成图片…"） */
  onImageStatus?: (text: string) => void
}

/**
 * 流式对话（SSE）：POST /chat/stream
 * 服务端负责保存用户消息与 AI 回复；是否生图由模型自主通过工具决定
 * @returns 完整 AI 回复文本
 */
export async function streamChat(
  payload: {
    conversationId?: string
    content: string
    model?: string
    /** Agent 模式：chat=普通对话（默认）；character_design=角色设计智能体 */
    mode?: 'chat' | 'character_design'
    attachments?: MessageAttachment[]
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  const token = getToken()
  const res = await fetch('/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  })

  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      const m = body?.message
      msg = Array.isArray(m) ? m[0] : m || msg
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new Error(msg)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 以 \n\n 分割事件
    const events = buffer.split('\n\n')
    buffer = events.pop() || ''

    for (const event of events) {
      if (!event.trim()) continue
      for (const line of event.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return full
        try {
          const obj = JSON.parse(data)
          if (obj.error) throw new Error(String(obj.error))
          if (obj.conversation_id) {
            callbacks.onMeta?.({ conversation_id: obj.conversation_id, title: obj.title })
          }
          if (typeof obj.thinking === 'string') {
            callbacks.onThinking?.(obj.thinking)
          }
          if (typeof obj.image === 'string') {
            callbacks.onImage?.(obj.image)
          }
          if (typeof obj.image_status === 'string') {
            callbacks.onImageStatus?.(obj.image_status)
          }
          if (typeof obj.chunk === 'string') {
            full += obj.chunk
            callbacks.onChunk(obj.chunk)
          }
        } catch (e) {
          // JSON 解析失败：非 JSON 事件直接忽略；业务错误继续上抛
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
    }
  }
  return full
}