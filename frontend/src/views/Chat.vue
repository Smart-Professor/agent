<script setup lang="ts">
import { computed, ref, nextTick, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { uploadAttachment, type MessageAttachment } from '@/api/chat'
import ChatMessage from '@/components/ChatMessage.vue'

const chat = useChatStore()
const app = useAppStore()
const auth = useAuthStore()

const input = ref('')
const sending = ref(false)
/** Agent 模式：chat=普通对话；character_design=角色设计智能体 */
const agentMode = ref<'chat' | 'character_design'>('chat')
const abortController = ref<AbortController | null>(null)
const messagesEl = ref<HTMLElement | null>(null)

/** 待发送的附件（已上传 R2，发送时随消息提交） */
const pendingAttachments = ref<MessageAttachment[]>([])
const uploading = ref(false)

/** 拖拽上传：拖入聊天区时显示半透明遮罩 */
const dragCounter = ref(0)
const isDragging = computed(() => dragCounter.value > 0)

const userName = computed(() => auth.user?.nickname || auth.user?.email?.split('@')[0] || '朋友')

const suggestions = [
  {
    title: '写一个待办清单',
    desc: '用于个人项目或日常任务',
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>`,
    tint: '#eef2ff',
    color: '#4f46e5',
  },
  {
    title: '生成一封邮件',
    desc: '回复录用通知',
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>`,
    tint: '#fdf2f8',
    color: '#db2777',
  },
  {
    title: 'AI 是如何工作的',
    desc: '从技术角度解释原理',
    icon: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4M12 8h.01"/>
    </svg>`,
    tint: '#ecfeff',
    color: '#0891b2',
  },
]

onMounted(() => {
  // 拉取当前用户的会话列表；默认停留在"新对话"草稿态
  chat.refresh().catch(() => {})
  // 拉取模型清单（含多模态能力声明），失败时用内置回退清单
  app.loadModels()
})

async function scrollToBottom() {
  await nextTick()
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

watch(() => chat.messages.length, scrollToBottom)
watch(() => chat.messages.map((m) => m.content).join(''), scrollToBottom)

function useSuggestion(s: typeof suggestions[number]) {
  input.value = `${s.title} ${s.desc}`
  send()
}

/** 当前生效的模型：会话已设 > 草稿选择 > 全局默认（输入框右下角显示用） */
const currentModel = computed(
  () =>
    (chat.activeId ? chat.activeModel : chat.draftModel) ?? app.defaultModel,
)

/** 当前模型的多模态能力（决定图片/语音附件是否可用；文档附件任何模型都能用） */
const modelCaps = computed(() => app.modelCapabilities(currentModel.value))

/** 附件类型识别（与服务端 MIME 分类保持一致） */
function classifyFile(file: File): MessageAttachment['type'] {
  const mime = file.type || ''
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  // 视频 / 文档统一归 file（模型无法直接理解视频，但可存储并在消息中展示）
  return 'file'
}

/** 拖拽进入 / 离开（用计数器避免子元素抖动） */
function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  dragCounter.value++
}
function onDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(e: DragEvent) {
  e.preventDefault()
  dragCounter.value = Math.max(0, dragCounter.value - 1)
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  dragCounter.value = 0
  if (sending.value || uploading.value) return
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) handleFiles(files)
}

/** 粘贴：剪贴板里的图片直接作为附件上传 */
function onPaste(e: ClipboardEvent) {
  if (sending.value || uploading.value) return
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) handleFiles(files)
}

/** 处理文件（拖拽 / 粘贴共用）：能力门控 → 上传 R2 → 进入待发送列表 */
async function handleFiles(files: File[]) {
  if (!files.length) return

  // 能力门控：图片理解需要模型支持 vision，语音理解需要支持 audio
  for (const f of files) {
    const type = classifyFile(f)
    if (type === 'image' && !modelCaps.value.vision) {
      ElMessage.warning('当前模型不支持图片理解，请切换到多模态模型（如 MiMo v2.5）')
      return
    }
    if (type === 'audio' && !modelCaps.value.audio) {
      ElMessage.warning('当前模型不支持语音理解，请切换到支持音频的模型')
      return
    }
  }

  uploading.value = true
  try {
    for (const f of files) {
      const att = await uploadAttachment(f)
      const { key: _key, ...rest } = att
      pendingAttachments.value.push(rest)
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '附件上传失败')
  } finally {
    uploading.value = false
  }
}

function removeAttachment(index: number) {
  pendingAttachments.value.splice(index, 1)
}

function formatSize(size?: number): string {
  if (!size) return ''
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(size / 1024)}KB`
}

/** 只发了附件没写文字时，补一条默认指令 */
function fallbackPrompt(atts: MessageAttachment[]): string {
  if (atts.some((a) => a.type === 'image')) return '请描述并分析这张图片'
  if (atts.some((a) => a.type === 'audio')) return '请听一下这段音频并总结内容'
  if (atts.some((a) => a.mime?.startsWith('video/'))) return '这是一段视频文件，请说明你无法直接观看视频，但可以回答与视频主题相关的问题'
  return '请阅读附件内容并总结要点'
}

async function send() {
  const prompt = input.value.trim() || (pendingAttachments.value.length ? fallbackPrompt(pendingAttachments.value) : '')
  if (!prompt || sending.value) return

  const attachments = pendingAttachments.value.length ? [...pendingAttachments.value] : undefined

  input.value = ''
  pendingAttachments.value = []
  sending.value = true

  const controller = new AbortController()
  abortController.value = controller

  try {
    // 用户消息与 AI 回复均由后端落库，不同账号自动隔离；是否生图由模型自主通过工具决定
    await chat.sendMessage(prompt, controller.signal, { attachments, mode: agentMode.value })
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      ElMessage.error(e?.message || '生成失败')
    }
  } finally {
    sending.value = false
    abortController.value = null
  }
}

function stop() {
  abortController.value?.abort()
}

/** 切换会话模型：已落库会话同步后端，草稿态仅本地记录 */
async function onModelChange(model: string | null) {
  try {
    await chat.switchModel(chat.activeId, model)
    ElMessage.success(model ? `已切换为 ${model}` : '已恢复默认模型')
  } catch (e: any) {
    ElMessage.error(e?.message || '切换模型失败')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

const hasMessages = () => chat.messages.length > 0

/** ---- 上下文窗口用量（聊天区顶部进度条） ---- */
/** 模型上下文上限（token）；与 registry 保持 128k 量级的估算 */
const CTX_LIMIT = 128 * 1024
/** 粗略 token 估算：中文约 1 字/token，英文约 4 字符/token，折中取 2.5 字符/token */
const ctxUsedTokens = computed(() => {
  const chars = chat.messages.reduce((n, m) => n + (m.content?.length || 0) + (m.thinking?.length || 0), 0)
  return Math.round(chars / 2.5)
})
const ctxPercent = computed(() => Math.min(100, (ctxUsedTokens.value / CTX_LIMIT) * 100))
/** 三挡：0=关（隐藏进度条） 1=简（仅进度条） 2=详（进度条+百分比，告警线提高到95%） */
const ctxGears = [
  { value: 0, label: '关' },
  { value: 1, label: '简' },
  { value: 2, label: '详' },
]
const ctxGear = ref(Number(localStorage.getItem('ctxGear') ?? 1))
function setCtxGear(v: number) {
  ctxGear.value = v
  localStorage.setItem('ctxGear', String(v))
}
const ctxText = computed(() => {
  if (ctxGear.value === 0) return '上下文用量'
  const used = ctxUsedTokens.value
  const label = used >= 1024 ? `${(used / 1024).toFixed(1)}k` : `${used}`
  return ctxGear.value === 2 ? `上下文 ${label} / 128k (${ctxPercent.value.toFixed(0)}%)` : `上下文 ${label}`
})
/** 占用超过告警线后变红提醒 */
const ctxWarn = computed(() => ctxPercent.value >= (ctxGear.value === 2 ? 95 : 80))

/** ---- 聊天区域宽度三挡开关（小/中/大） ---- */
const widthGears = [
  { value: 0, label: '小', max: '760px' },
  { value: 1, label: '中', max: '1100px' },
  { value: 2, label: '大', max: '1440px' },
]
const widthGear = ref(Number(localStorage.getItem('widthGear') ?? 1))
function setWidthGear(v: number) {
  widthGear.value = v
  localStorage.setItem('widthGear', String(v))
}
const widthMax = computed(() => widthGears[widthGear.value].max)

async function resetChat() {
  // 草稿态：直接清空
  if (!chat.activeId) {
    chat.newConversation()
    return
  }
  try {
    await ElMessageBox.confirm('删除当前对话及其全部消息？消息将同时从服务器删除。', '重置对话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户取消
  }
  try {
    await chat.deleteConversation(chat.activeId)
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  }
}
</script>

<template>
  <div
    class="chat"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- 拖拽上传遮罩 -->
    <Transition name="fade">
      <div v-if="isDragging" class="drag-overlay">
        <div class="drag-overlay__inner">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p>松开以上传文件</p>
        </div>
      </div>
    </Transition>
    <!-- 顶部导航栏 -->
    <header class="chat__header">
      <div class="header-left">
        <button class="menu-btn" @click="app.toggleSidebar()" title="菜单">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <span class="conv-title">{{ chat.activeConversation?.title || '新对话' }}</span>
      </div>
      <div class="header-right">
        <!-- 聊天区域宽度三挡开关（小/中/大） -->
        <div class="ctx-seg width-seg" role="radiogroup" aria-label="聊天区域宽度">
          <div class="ctx-seg__thumb" :style="{ transform: `translateX(${widthGear * 100}%)` }"></div>
          <button
            v-for="g in widthGears"
            :key="g.value"
            class="ctx-seg__btn"
            :class="{ 'ctx-seg__btn--active': widthGear === g.value }"
            :title="`聊天区域宽度：${g.label}`"
            @click="setWidthGear(g.value)"
          >{{ g.label }}</button>
        </div>
        <button v-if="hasMessages()" class="reset-btn" @click="resetChat" title="重置对话">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7"/>
            <path d="M3 4v5h5"/>
          </svg>
          <span>重置</span>
        </button>
        <div class="user-avatar">
          <img v-if="auth.user?.avatar" :src="auth.user.avatar" alt="头像" />
          <span v-else>{{ userName.charAt(0) }}</span>
        </div>
      </div>
    </header>

    <!-- 消息区域 -->
    <div class="chat__messages" ref="messagesEl">
      <!-- 上下文窗口用量（三挡可调开关） -->
      <div v-if="hasMessages()" class="ctx-bar" :class="{ 'ctx-bar--warn': ctxWarn }">
        <template v-if="ctxGear !== 0">
          <span class="ctx-bar__text">{{ ctxText }}</span>
          <div class="ctx-bar__track">
            <div class="ctx-bar__fill" :style="{ width: ctxPercent + '%' }"></div>
          </div>
        </template>
        <div class="ctx-seg" role="radiogroup" aria-label="上下文用量显示挡位">
          <div class="ctx-seg__thumb" :style="{ transform: `translateX(${ctxGear * 100}%)` }"></div>
          <button
            v-for="g in ctxGears"
            :key="g.value"
            class="ctx-seg__btn"
            :class="{ 'ctx-seg__btn--active': ctxGear === g.value }"
            :title="g.value === 0 ? '隐藏用量条' : g.value === 1 ? '显示用量条' : '显示用量条和百分比'"
            @click="setCtxGear(g.value)"
          >{{ g.label }}</button>
        </div>
      </div>
      <div class="messages-inner">
        <!-- 欢迎空状态 -->
        <div v-if="!hasMessages()" class="welcome">
          <div class="welcome__badge">
            <span class="badge-dot"></span>
            Hello AI 已就绪
          </div>
          <h2 class="welcome__hi">Hi {{ userName }}</h2>
          <h1 class="welcome__question">今天想聊点什么？</h1>
          <p class="welcome__subtitle">
            从下面的常用提示开始<br/>
            或直接输入你自己的问题
          </p>

          <div class="suggestions">
            <button
              v-for="(s, i) in suggestions"
              :key="i"
              class="suggestion-card"
              @click="useSuggestion(s)"
            >
              <div class="suggestion-icon" :style="{ background: s.tint, color: s.color }" v-html="s.icon"></div>
              <div class="suggestion-text">
                <span class="suggestion-title">{{ s.title }}</span>
                <span class="suggestion-desc">{{ s.desc }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-else class="message-list">
          <ChatMessage
            v-for="msg in chat.messages"
            :key="msg.id"
            :message="msg"
            :user-avatar="auth.user?.avatar"
            :ai-avatar="chat.activeConversation?.aiAvatar || auth.user?.aiAvatar"
          />
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="chat__input">
      <!-- 待发送附件预览条 -->
      <transition-group name="att" tag="div" class="attach-preview" v-if="pendingAttachments.length">
        <div
          v-for="(att, i) in pendingAttachments"
          :key="att.url"
          class="attach-chip"
          :class="{ 'attach-chip--image': att.type === 'image' }"
        >
          <img v-if="att.type === 'image'" :src="att.url" class="attach-chip__img" alt="图片预览" />
          <span v-else class="attach-chip__icon">
            <svg v-if="att.type === 'audio'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          </span>
          <span class="attach-chip__name" :title="att.name">{{ att.name || '附件' }}<i v-if="att.size">{{ formatSize(att.size) }}</i></span>
          <button class="attach-chip__remove" @click="removeAttachment(i)" title="移除">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </transition-group>

      <div class="input-wrap">
        <span v-if="uploading" class="upload-spinner" title="上传中…"></span>

        <textarea
          v-model="input"
          class="input-area"
          :rows="1"
          placeholder="输入问题，也可以直接让我画一张图，或拖入图片 / 视频 / 文档…"
          @keydown="onKeydown"
          @paste="onPaste"
          :disabled="sending"
        ></textarea>

        <button
          v-if="!sending"
          class="send-btn"
          :disabled="!input.trim() && !pendingAttachments.length"
          @click="send"
          title="发送"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7"/>
          </svg>
        </button>
        <button v-else class="stop-btn" @click="stop" title="停止生成">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <rect x="5" y="5" width="14" height="14" rx="2"/>
          </svg>
        </button>
      </div>
      <!-- 输入框下方：Agent 模式切换（左） + 会话模型切换（右）；是否生图由模型自主判断，无需手动切换 -->
      <div class="input-footer">
        <el-radio-group
          v-model="agentMode"
          size="small"
          :disabled="sending"
          class="mode-switch"
        >
          <el-radio-button value="chat">对话</el-radio-button>
          <el-radio-button value="character_design">角色设计</el-radio-button>
        </el-radio-group>
        <span class="model-hint">当前模型</span>
        <el-select
          class="model-select"
          :model-value="currentModel"
          size="small"
          :disabled="sending"
          @update:model-value="onModelChange"
        >
          <el-option
            v-for="m in app.MODEL_OPTIONS"
            :key="m.id"
            :label="m.id === app.defaultModel ? `${m.label} · 默认` : m.label"
            :value="m.id"
          />
        </el-select>
      </div>
      <p class="input-hint">
        {{ modelCaps.vision || modelCaps.audio
          ? '直接说出画图需求即可生成图片；也可拖入图片 / 视频 / 文档 / 音频，内容由 AI 生成，请注意甄别'
          : '直接说出画图需求即可生成图片；拖入的文档可直接阅读，内容由 AI 生成，请注意甄别' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: transparent;
  position: relative;
  z-index: 1;
}

/* ---- 上下文窗口用量进度条 ---- */
.ctx-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 24px;
  background: rgba(255, 255, 255, 0.68);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(31, 41, 55, 0.05);
}
.ctx-bar__track {
  flex: 1;
  max-width: 320px;
  height: 6px;
  border-radius: 3px;
  background: rgba(31, 41, 55, 0.08);
  overflow: hidden;
}
.ctx-bar__fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #0a84ff, #5e6ad2);
  transition: width 0.3s ease;
}
.ctx-bar--warn .ctx-bar__fill {
  background: linear-gradient(90deg, #f59e0b, #ef4444);
}
.ctx-bar__text {
  font-size: 11.5px;
  color: #86868b;
  white-space: nowrap;
}
.ctx-bar--warn .ctx-bar__text {
  color: #f87171;
  font-weight: 600;
}
/* 三挡分段开关（滑块动画 + 主题紫） */
.ctx-seg {
  position: relative;
  display: flex;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.05);
  border: 1px solid rgba(17, 24, 39, 0.06);
  padding: 2px;
  flex-shrink: 0;
  box-sizing: border-box;
}
.ctx-seg__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc((100% - 4px) / 3);
  height: calc(100% - 4px);
  border-radius: 999px;
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
  box-shadow: 0 1px 4px rgba(10, 132, 255, 0.35);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.ctx-seg__btn {
  position: relative;
  z-index: 1;
  width: 34px;
  padding: 2px 0;
  border: none;
  background: none;
  border-radius: 999px;
  font-size: 11.5px;
  color: #86868b;
  cursor: pointer;
  transition: color 0.2s;
}
.ctx-seg__btn--active {
  color: #fff;
  font-weight: 600;
}
/* 头部宽度开关（小/中/大）：与主题开关同款，仅微调尺寸适配顶栏 */
.width-seg {
  margin-right: 10px;
}
.width-seg .ctx-seg__btn {
  width: 30px;
  font-size: 11px;
}

/* ---- 顶部导航 ---- */
.chat__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.68);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(17, 24, 39, 0.05);
  position: relative;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.menu-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #6e6e73;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}
.menu-btn:hover {
  background: rgba(17, 24, 39, 0.06);
  color: #1d1d1f;
}
.conv-title {
  font-size: 14.5px;
  font-weight: 600;
  color: #1d1d1f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13.5px;
  font-weight: 600;
  box-shadow: 0 3px 8px rgba(10, 132, 255, 0.22);
  overflow: hidden;
}
.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.reset-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border: 1px solid rgba(17, 24, 39, 0.1);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.6);
  color: #86868b;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.reset-btn:hover {
  border-color: rgba(17, 24, 39, 0.2);
  color: #1d1d1f;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.08);
}

/* ---- 消息区 ---- */
.chat__messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
.chat__messages::-webkit-scrollbar { width: 5px; }
.chat__messages::-webkit-scrollbar-thumb {
  background: rgba(17, 24, 39, 0.14);
  border-radius: 3px;
}

.messages-inner {
  max-width: v-bind(widthMax);
  margin: 0 auto;
  padding: 12px 28px;
}

/* ---- 欢迎空状态 ---- */
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px 0 32px;
  animation: fadeIn 0.5s ease;
}
.welcome__badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 14px;
  border-radius: 20px;
  background: rgba(91, 91, 214, 0.06);
  border: 1px solid rgba(91, 91, 214, 0.18);
  color: #4340c0;
  font-size: 12.5px;
  font-weight: 500;
  margin-bottom: 24px;
}
.badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15); }
  50% { box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.08); }
}
.welcome__hi {
  font-size: 16px;
  font-weight: 500;
  color: #86868b;
  margin: 0 0 10px;
  letter-spacing: -0.01em;
}
.welcome__question {
  font-size: 34px;
  font-weight: 700;
  margin: 0 0 14px;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: #16161a;
}
.welcome__subtitle {
  color: #86868b;
  font-size: 14px;
  margin: 0 0 44px;
  line-height: 1.7;
}

/* ---- 建议卡片 ---- */
.suggestions {
  display: flex;
  gap: 14px;
  width: 100%;
  max-width: 720px;
  justify-content: center;
}
.suggestion-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(17, 24, 39, 0.07);
  border-radius: 16px;
  text-align: left;
  cursor: pointer;
  transition: all 0.25s ease;
  max-width: 220px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03), 0 8px 24px rgba(17, 24, 39, 0.05);
}
.suggestion-card:hover {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(91, 91, 214, 0.25);
  box-shadow: 0 4px 14px rgba(17, 24, 39, 0.08);
  transform: translateY(-3px);
}
.suggestion-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.suggestion-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.suggestion-title {
  font-size: 14px;
  font-weight: 600;
  color: #1d1d1f;
  line-height: 1.3;
}
.suggestion-desc {
  font-size: 12.5px;
  color: #86868b;
  line-height: 1.4;
}

/* ---- 消息列表 ---- */
.message-list {
  padding-top: 8px;
}

/* ---- 输入区 ---- */
.chat__input {
  display: flex;
  flex-direction: column; /* 输入框在上、模型切换在右下角 */
  align-items: center;    /* 输入框始终水平居中 */
  padding: 10px 28px 16px;
  flex-shrink: 0;
}
.input-wrap {
  width: 100%;
  max-width: v-bind(widthMax);
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 14px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 28px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 8px 24px rgba(17, 24, 39, 0.06);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.input-wrap:focus-within {
  border-color: rgba(91, 91, 214, 0.4);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 8px 24px rgba(91, 91, 214, 0.12);
}

/* 上传中加载圈（textarea 左侧） */
.upload-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(99, 102, 241, 0.25);
  border-top-color: #6366f1;
  animation: ringSpin 0.8s linear infinite;
  flex-shrink: 0;
}

/* ---- 拖拽上传遮罩 ---- */
.drag-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(99, 102, 241, 0.08);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.drag-overlay__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 64px;
  border-radius: 24px;
  border: 2px dashed rgba(91, 91, 214, 0.45);
  background: rgba(255, 255, 255, 0.92);
  color: #4340c0;
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 20px 60px rgba(17, 24, 39, 0.12);
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ---- 待发送附件预览条 ---- */
.attach-preview {
  width: 100%;
  max-width: v-bind(widthMax);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 220px;
  padding: 6px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(17, 24, 39, 0.08);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 6px 16px rgba(17, 24, 39, 0.06);
  backdrop-filter: blur(10px);
}
.attach-chip--image {
  padding: 4px;
}
.attach-chip__img {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 9px;
  display: block;
}
.attach-chip__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(91, 91, 214, 0.08);
  color: #4340c0;
  flex-shrink: 0;
}
.attach-chip__name {
  font-size: 12.5px;
  color: #3a3a40;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.attach-chip__name i {
  font-style: normal;
  font-size: 11px;
  color: #86868b;
  flex-shrink: 0;
}
.attach-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(17, 24, 39, 0.06);
  color: #86868b;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.attach-chip__remove:hover {
  background: rgba(214, 69, 69, 0.12);
  color: #b3261e;
}
/* 附件条增删动画 */
.att-enter-active, .att-leave-active { transition: all 0.22s ease; }
.att-enter-from, .att-leave-to { opacity: 0; transform: translateY(6px) scale(0.94); }
.att-leave-active { position: absolute; }

.input-area {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: #1d1d1f;
  font-size: 15px;
  line-height: 1.5;
  resize: none;
  max-height: 160px;
  font-family: inherit;
  padding: 6px 0;
}
.input-area::placeholder { color: #a1a1a6; }
.input-area:disabled { opacity: 0.5; }

.send-btn, .stop-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}
.send-btn {
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
  color: #fff;
  box-shadow: 0 3px 10px rgba(10, 132, 255, 0.3);
}
.send-btn:hover:not(:disabled) {
  transform: scale(1.06);
  box-shadow: 0 5px 14px rgba(10, 132, 255, 0.38);
}
.send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
.stop-btn {
  background: #ef4444;
  color: #fff;
}
.stop-btn:hover { background: #dc2626; }

/* 输入框下方工具条：模式切换靠左、模型切换靠右下 */
.input-footer {
  width: 100%;
  max-width: v-bind(widthMax);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
.model-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #86868b;
  padding-left: 4px;
}
.model-select {
  width: 220px;
  flex-shrink: 0;
  --el-border-radius-base: 999px;
}
/* 模型切换框：玻璃拟态胶囊，与主题一致 */
.model-select :deep(.el-select__wrapper) {
  height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 0 0 1px rgba(91, 91, 214, 0.16) inset;
  transition: box-shadow 0.2s, background 0.2s;
}
.model-select :deep(.el-select__wrapper:hover) {
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1.5px rgba(91, 91, 214, 0.35) inset,
  0 2px 10px rgba(17, 24, 39, 0.06);
}
.model-select :deep(.el-select__wrapper.is-focused) {
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1.5px rgba(91, 91, 214, 0.55) inset,
  0 3px 14px rgba(17, 24, 39, 0.08);
}
.model-select :deep(.el-select__placeholder),
.model-select :deep(.el-select__selected-item) {
  font-size: 12.5px;
  color: #3a3a40;
}
.model-select :deep(.el-select__caret) {
  color: #86868b;
}
/* 下拉面板：圆角 + 淡紫高亮当前项 */
.model-select :deep(.el-select-dropdown) {
  border-radius: 14px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  box-shadow: 0 10px 32px rgba(17, 24, 39, 0.1);
}
.model-select :deep(.el-select-dropdown__item) {
  border-radius: 8px;
  margin: 2px 6px;
  font-size: 12.5px;
}
.model-select :deep(.el-select-dropdown__item.is-hovering) {
  background: rgba(91, 91, 214, 0.06);
}
.model-select :deep(.el-select-dropdown__item.is-selected) {
  color: #4340c0;
  font-weight: 600;
  background: rgba(91, 91, 214, 0.08);
}
.input-hint {
  max-width: 720px;
  margin: 8px auto 0;
  text-align: center;
  font-size: 11.5px;
  color: #a1a1a6;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 720px) {
  .menu-btn { display: flex; }
  .suggestions { flex-direction: column; align-items: stretch; }
  .suggestion-card { max-width: none; }
  .welcome__question { font-size: 26px; }
  .chat__header { padding: 12px 16px; }
  .messages-inner { padding: 8px 16px; }
  .chat__input { padding: 10px 16px 12px; }
}
</style>
