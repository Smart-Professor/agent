import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import {
  deleteConversation as apiDeleteConversation,
  listConversations,
  listMessages,
  resetConversationAiAvatar as apiResetAiAvatar,
  setConversationModel as apiSetModel,
  streamChat,
  uploadConversationAiAvatar as apiUploadAiAvatar,
  type ChatMessageRecord,
  type ConversationSummary,
  type MessageAttachment,
} from '@/api/chat'
import { MODEL_OPTIONS } from '@/stores/app'

// 模型清单统一维护在 stores/app.ts（后端 /chat/models → Python 注册表动态加载），此处仅转发供旧引用使用
export { MODEL_OPTIONS }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 模型思考过程（reasoning），仅流式当次会话保存在内存，不入库 */
  thinking?: string
  streaming?: boolean
  error?: boolean
  /** 多模态附件（图片/文档/音频），随消息入库 */
  attachments?: MessageAttachment[]
  /** 生图工具执行中的临时提示（仅流式当次会话展示，图片到达后清除） */
  imageStatus?: string
  time: number
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  loaded: boolean
  /** 本会话专属 AI 头像；为空时回退用户全局默认 */
  aiAvatar?: string | null
  /** 本会话使用的模型 ID；为空表示默认模型 */
  model?: string | null
}

/** 发送消息的可选配置 */
export interface SendOptions {
  /** 多模态附件（已先上传到 R2） */
  attachments?: MessageAttachment[]
  /** Agent 模式：chat=普通对话（默认）；character_design=角色设计智能体 */
  mode?: 'chat' | 'character_design'
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const useChatStore = defineStore('chat', () => {
  /** 会话列表（来自后端，按最近更新排序） */
  const conversations = ref<Conversation[]>([])
  /** 当前会话 ID；空字符串表示"新对话（未落库草稿）" */
  const activeId = ref('')
  /** 草稿消息（首次发送前后端尚未创建会话） */
  const draftMessages = ref<ChatMessage[]>([])
  const listLoaded = ref(false)
  const loadingList = ref(false)
  const loadingMessages = ref(false)

  const activeConversation = computed<Conversation | null>(
    () => conversations.value.find((c) => c.id === activeId.value) || null,
  )

  /** 当前展示的消息：草稿或已加载会话 */
  const messages = computed<ChatMessage[]>(() =>
    activeId.value ? activeConversation.value?.messages ?? [] : draftMessages.value,
  )

  function mapRecord(m: ChatMessageRecord): ChatMessage {
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      attachments: m.attachments ?? undefined,
      time: new Date(m.createdAt).getTime(),
    }
  }

  /** 拉取会话列表（保留各会话已加载的消息缓存） */
  async function refresh() {
    loadingList.value = true
    try {
      const list = await listConversations()
      const prev = new Map(conversations.value.map((c) => [c.id, c]))
      conversations.value = list.map((s: ConversationSummary) => ({
        id: s.id,
        title: s.title,
        createdAt: new Date(s.createdAt).getTime(),
        updatedAt: new Date(s.updatedAt).getTime(),
        messages: prev.get(s.id)?.messages ?? [],
        loaded: prev.get(s.id)?.loaded ?? false,
        aiAvatar: s.aiAvatar ?? null,
        model: s.model ?? null,
      }))
    } finally {
      loadingList.value = false
      listLoaded.value = true
    }
  }

  /** 选中会话并按需从后端加载消息 */
  async function selectConversation(id: string) {
    activeId.value = id
    const conv = conversations.value.find((c) => c.id === id)
    if (!conv || conv.loaded) return
    loadingMessages.value = true
    try {
      conv.messages = (await listMessages(id)).map(mapRecord)
      conv.loaded = true
    } finally {
      loadingMessages.value = false
    }
  }

  /** 新建对话：回到草稿态 */
  function newConversation() {
    activeId.value = ''
    draftMessages.value = []
    draftModel.value = null
  }

  /** 删除会话（后端 + 本地） */
  async function deleteConversation(id: string) {
    await apiDeleteConversation(id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (activeId.value === id) newConversation()
  }

  /** 上传会话专属 AI 头像 */
  async function uploadAiAvatar(id: string, file: File) {
    return apiUploadAiAvatar(id, file)
  }

  /** 清除会话专属 AI 头像 */
  async function resetAiAvatar(id: string) {
    return apiResetAiAvatar(id)
  }

  /** 当前会话使用的模型（草稿态返回空 = 默认模型） */
  const activeModel = computed(() =>
    activeId.value ? activeConversation.value?.model ?? null : null,
  )

  /** 切换会话模型：已落库会话同步后端；草稿态仅本地记录，首次发送时随消息提交 */
  async function switchModel(id: string, model: string | null) {
    if (!id) {
      draftModel.value = model
      return
    }
    await apiSetModel(id, model)
    const conv = conversations.value.find((c) => c.id === id)
    if (conv) conv.model = model
  }
  /** 草稿态选中的模型（新建会话首次发送时生效） */
  const draftModel = ref<string | null>(null)

  /** 重置全部状态（退出登录时调用，防止串号看到上一位用户的会话） */
  function reset() {
    conversations.value = []
    activeId.value = ''
    draftMessages.value = []
    listLoaded.value = false
  }

  /**
   * 发送消息：用户消息与 AI 回复均由服务端落库
   * - 草稿态：后端创建会话并通过 onMeta 返回真实 ID，前端自动升级
   * - 带附件时由服务端组装多模态内容块发给模型；文生图模式直接返回图片
   * @returns AI 完整回复；可传 AbortSignal 中途停止
   */
  async function sendMessage(
    content: string,
    signal?: AbortSignal,
    options: SendOptions = {},
  ): Promise<string> {
    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content,
      attachments: options.attachments?.length ? options.attachments : undefined,
      time: Date.now(),
    }
    // 必须用 reactive 包裹：push 进响应式数组后，onChunk/onThinking 会在闭包里持续修改
    // 该对象。若直接用普通对象，修改的是"原始对象"而非数组读出的响应式代理，
    // 不会触发依赖通知，界面在整轮流式期间都不会刷新（表现为一直转圈、刷新后才看到回复）。
    const aiMsg = reactive<ChatMessage>({
      id: uid(),
      role: 'assistant',
      content: '',
      streaming: true,
      time: Date.now(),
    })

    if (activeId.value) {
      activeConversation.value?.messages.push(userMsg, aiMsg)
    } else {
      draftMessages.value.push(userMsg, aiMsg)
    }

    try {
      const full = await streamChat(
        {
          conversationId: activeId.value || undefined,
          content,
          // 草稿态用 draftModel；已落库会话后端会用自己的 model（显式值仍可覆盖）
          model: (activeId.value ? activeModel.value : draftModel.value) || undefined,
          mode: options.mode,
          attachments: options.attachments,
        },
        {
          onMeta: (meta) => {
            const id = meta.conversation_id
            if (!id) return
            if (!activeId.value) {
              // 后端已创建会话：草稿升级为正式会话
              const conv: Conversation = {
                id,
                title: meta.title?.slice(0, 24) || '新对话',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: draftMessages.value,
                loaded: true,
                aiAvatar: null,
                // 首次发送时把草稿态选择的模型落到新会话（后端已用该模型生成）
                model: draftModel.value ?? null,
              }
              conversations.value.unshift(conv)
              draftMessages.value = []
              activeId.value = id
            } else if (id === activeId.value && meta.title) {
              const conv = activeConversation.value
              if (conv) conv.title = meta.title.slice(0, 24)
            }
          },
          onThinking: (chunk) => {
            aiMsg.thinking = (aiMsg.thinking ?? '') + chunk
          },
          onChunk: (chunk) => {
            aiMsg.content += chunk
          },
          onImageStatus: (text) => {
            // 生图工具执行中：临时提示（图片或正文到达后清除）
            aiMsg.imageStatus = text
          },
          onImage: (url) => {
            // 模型生图工具结果：挂到 AI 消息附件上展示（服务端已落库），并清除生成中提示
            aiMsg.imageStatus = undefined
            aiMsg.attachments = [
              ...(aiMsg.attachments ?? []),
              { type: 'image', url, mime: 'image/jpeg' },
            ]
          },
        },
        signal,
      )
      aiMsg.streaming = false
      aiMsg.imageStatus = undefined
      // 静默同步侧边栏排序与消息计数
      refresh().catch(() => {})
      return full
    } catch (e) {
      aiMsg.streaming = false
      if ((e as Error)?.name !== 'AbortError') aiMsg.error = true
      throw e
    }
  }

  return {
    conversations,
    activeId,
    messages,
    activeConversation,
    listLoaded,
    loadingList,
    loadingMessages,
    activeModel,
    draftModel,
    MODEL_OPTIONS,
    switchModel,
    refresh,
    selectConversation,
    newConversation,
    deleteConversation,
    reset,
    sendMessage,
    uploadAiAvatar,
    resetAiAvatar,
  }
})