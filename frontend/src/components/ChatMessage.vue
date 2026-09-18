<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { ChatMessage } from '@/stores/chat'
import CharacterShowcase from './CharacterShowcase.vue'

const props = defineProps<{
  message: ChatMessage
  /** 用户头像 URL（来自 auth.user.avatar） */
  userAvatar?: string | null
  /** AI 头像 URL（优先会话级，回退全局默认） */
  aiAvatar?: string | null
}>()

const isUser = computed(() => props.message.role === 'user')

// ---- 角色设计模式识别与展示 ----
const showRaw = ref(false)
/** 内容含固定六段结构的关键标题时判定为角色设计方案 */
const isCharacterDesign = computed(
  () =>
    !isUser.value &&
    /角色基础信息/.test(displayContent.value) &&
    (/视觉方案|绘图提示词|人物内核/.test(displayContent.value)),
)
/** AI 消息里的图片附件（角色立绘等）：角色设计模式下从气泡拆出，独立成图鉴区 */
const imageAtts = computed(() =>
  (props.message.attachments ?? [])
    .filter((a) => a.type === 'image')
    .map((a) => ({ url: a.url, name: a.name })),
)
/** 气泡内展示的附件：角色设计模式排除图片（图片走独立图鉴区），其余模式原样 */
const textAtts = computed(() =>
  isCharacterDesign.value
    ? (props.message.attachments ?? []).filter((a) => a.type !== 'image')
    : (props.message.attachments ?? []),
)
const displayContent = computed(() => props.message.content || '')

/* ---- 思考过程折叠区 ---- */
/** 是否处于"正文尚未开始、思考流式进行中"阶段 */
const isThinking = computed(
  () => !!props.message.streaming && !displayContent.value && !!props.message.thinking,
)
const thinkingOpen = ref(false)
let userToggled = false // 用户手动展开/折叠后不再自动切换

// 默认行为：思考中自动展开让用户实时看到进展，正文开始后自动收起
watch(
  () => [props.message.streaming, displayContent.value, props.message.thinking],
  () => {
    if (userToggled) return
    thinkingOpen.value = isThinking.value
  },
  { immediate: true },
)

function toggleThinking() {
  userToggled = true
  thinkingOpen.value = !thinkingOpen.value
}

/** 轻量语法高亮：关键字 / 字符串 / 注释 / 数字 / 函数名（通用多语言近似） */
function highlightCode(code: string): string {
  const KW = /\b(abstract|as|async|await|bool|break|case|catch|class|const|continue|def|default|do|elif|else|except|export|extends|finally|for|from|function|if|import|in|instanceof|int|interface|is|lambda|let|new|None|not|or|and|pass|print|private|public|raise|return|self|static|str|super|switch|this|throw|True|False|try|type|typeof|var|void|while|with|yield|match|enum|struct|impl|fn|pub|use|mod|end|then|begin|nil|null|undefined|true|false)\b/g
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // 先转义，再按"字符串/注释优先"策略逐段处理，避免标签内部再被匹配
  const parts: string[] = []
  // 匹配顺序：注释(# 或 //) → 字符串(单双引号/三引号) → 其他
  const re = /(#[^\n]*|\/\/[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    parts.push(escape(code.slice(last, m.index)))
    if (m[1]) {
      parts.push(`<span class="tok-cmt">${escape(m[1])}</span>`)
    } else {
      parts.push(`<span class="tok-str">${escape(m[2])}</span>`)
    }
    last = m.index + m[0].length
  }
  parts.push(escape(code.slice(last)))
  let html = parts.join('')

  const segs = html.split(/(<span class="tok-(?:cmt|str)">[\s\S]*?<\/span>)/)
  return segs
    .map((seg) => {
      if (seg.startsWith('<span class="tok-')) return seg
      return seg
        .replace(KW, '<span class="tok-kw">$1</span>')
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>')
        .replace(/\b([A-Za-z_]\w*)(?=\()/g, '<span class="tok-fn">$1</span>')
    })
    .join('')
}

/** 按行高亮并包裹行号 span（跨行 span 自动补齐闭合，保持单行 HTML 防止被逐行渲染拆散） */
function highlightLines(code: string): string {
  const highlighted = highlightCode(code)
  const rawLines = highlighted.split('\n')
  const lines: string[] = []
  let unclosed: string[] = [] // 进入当前行时仍未闭合的 span 开标签
  for (const line of rawLines) {
    const opens = [...unclosed]
    const re = /<span class="[^"]*">|<\/span>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      if (m[0] === '</span>') opens.pop()
      else opens.push(m[0])
    }
    const l = unclosed.join('') + line + '</span>'.repeat(opens.length)
    lines.push(`<span class="cl">${l || '&nbsp;'}</span>`)
    unclosed = opens
  }
  return lines.join('')
}

/** 轻量 Markdown 渲染：标题 / 加粗 / 行内代码 / 代码块 / 列表 / 换行 */
function renderMd(text: string): string {
  headingCounter = 0
  let html = text
  // 代码块 ```lang ... ``` -> 带 header（语言标签 + 复制按钮）的卡片
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const label = lang || '代码'
    return (
      `<div class="md-code">` +
      `<div class="md-code__bar"><span class="md-code__lang">${escapeHtml(label)}</span>` +
      `<button type="button" class="md-code__copy" data-code="${escapeAttr(code)}">复制</button></div>` +
      `<pre class="md-code__pre"><code>${highlightLines(code)}</code></pre></div>`
    )
  })
  const lines = html.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    // 关键修复：代码卡片是替换后生成的整行 HTML（内部无换行），必须原样输出，
    // 否则会被下方 inline() 二次转义，把整段卡片 HTML 当正文显示出来
    if (l.startsWith('<div class="md-code">')) { out.push(l); continue }
    // 表格：表头 + 分隔行 + 数据行
    if (l.trim().startsWith('|') && l.trim().endsWith('|')) {
      const t = collectTable(l, lines, i)
      if (t.startsWith('<table')) {
        out.push(t)
        i = tableEnd - 1 // 跳过已消费行
        continue
      }
      out.push(t)
      continue
    }
    // 孤立的表格分隔行跳过
    if (/^\|[\s:|-]+\|?$/.test(l.trim())) continue
    // 标题
    const h = l.match(/^(#{1,3})\s+(.*)$/)
    if (h) { headingCounter++; out.push(`<div class="md-h md-h${h[1].length}" id="md-h-${uid}-${headingCounter}">${inline(h[2])}</div>`); continue }
    // 有序 / 无序列表
    const ol = l.match(/^\d+\.\s+(.*)$/)
    if (ol) { out.push(`<div class="md-li md-li--num">${inline(ol[1])}</div>`); continue }
    const ul = l.match(/^[-*]\s+(.*)$/)
    if (ul) { out.push(`<div class="md-li">${inline(ul[1])}</div>`); continue }
    // 分隔线
    if (/^(-{3,}|\*{3,})$/.test(l.trim())) { out.push('<hr class="md-hr"/>'); continue }
    // 引用
    const q = l.match(/^>\s?(.*)$/)
    if (q) { out.push(`<div class="md-quote">${inline(q[1])}</div>`); continue }
    // 空行
    if (l.trim() === '') { out.push('<br/>'); continue }
    out.push(`<div class="md-p">${inline(l)}</div>`)
  }
  return out.join('')
}

let tableEnd = 0

/** 收集 Markdown 表格（第 i 行表头），非标准表格时按普通段落返回 */
function collectTable(headerLine: string, lines: string[], i: number): string {
  const sep = lines[i + 1]
  if (!sep || !/^\|[\s:|-]+\|?$/.test(sep.trim())) {
    return `<div class="md-p">${inline(headerLine)}</div>`
  }
  const headers = headerLine.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()))
  const rows: string[][] = []
  let j = i + 2
  while (j < lines.length && lines[j].trim().startsWith('|')) {
    rows.push(lines[j].trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())))
    j++
  }
  tableEnd = j
  const th = headers.map((c) => `<th>${c}</th>`).join('')
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  return `<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="md-strong">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em class="md-em">$1</em>')
    .replace(/~~([^~]+)~~/g, '<del class="md-del">$1</del>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 属性值转义（用于 data-code 存原始代码） */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;')
}

/** 事件委托：点击代码块上的「复制」按钮 */
async function onContentClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest?.('.md-code__copy') as HTMLElement | null
  if (!btn) return
  const raw = btn.dataset.code || ''
  const code = raw.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  try {
    await navigator.clipboard.writeText(code)
    btn.textContent = '已复制'
    ElMessage.success('代码已复制到剪贴板')
    setTimeout(() => (btn.textContent = '复制'), 1600)
  } catch {
    ElMessage.error('复制失败，请手动选择复制')
  }
}

const renderedHtml = computed(() =>
  isUser.value ? escapeHtml(displayContent.value) : renderMd(displayContent.value),
)

/* ---- 长回复标题导航（悬浮目录） ---- */
/** 组件级唯一前缀，避免多个消息间的锚点 id 冲突 */
const uid = Math.random().toString(36).slice(2, 8)
let headingCounter = 0
/** 从渲染结果中提取标题目录（含层级与锚点 id） */
const toc = computed(() => {
  if (isUser.value) return []
  const items: { id: string; text: string; level: number }[] = []
  const re = /<div class="md-h md-h(\d)" id="([^"]+)">([\s\S]*?)<\/div>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(renderedHtml.value))) {
    items.push({ id: m[2], text: m[3].replace(/<[^>]+>/g, ''), level: Number(m[1]) })
  }
  return items
})
/** 标题 >=2 且内容较长时才显示导航块 */
const showToc = computed(() => !isUser.value && toc.value.length >= 2 && displayContent.value.length > 500)
function scrollToHeading(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="msg-row" :class="{ 'msg-row--user': isUser }">
    <!-- 正文列：头像与气泡一行、立绘图鉴在其下方（全部参与文档流，撑开行高），目录仍悬浮在列右侧 -->
    <div class="msg-body">
      <div class="msg-line">
        <!-- 头像 -->
        <div class="avatar" :class="{ 'avatar--user': isUser, 'avatar--streaming': message.streaming && !isUser }">
          <img v-if="isUser && userAvatar" :src="userAvatar" alt="用户头像" />
          <span v-else-if="isUser">S</span>
          <img v-else-if="aiAvatar" :src="aiAvatar" alt="AI 头像" />
          <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
          <span v-if="message.streaming && !isUser" class="avatar-ring"></span>
        </div>

        <!-- 气泡 -->
        <div class="bubble" :class="{ 'bubble--user': isUser, 'bubble--error': message.error, 'bubble--streaming': message.streaming && !isUser }">
          <!-- 生图工具执行中的临时提示 -->
          <div v-if="!isUser && message.imageStatus" class="img-status">
            <span class="img-status__spin"></span>{{ message.imageStatus }}
          </div>
          <!-- 多模态附件（文字区内只放文档/音频；角色立绘图片走气泡下方的独立图鉴区） -->
          <div v-if="textAtts.length" class="bubble__atts">
            <template v-for="(att, i) in textAtts" :key="att.url + i">
              <a
                v-if="att.type === 'image'"
                class="att-image"
                :href="att.url"
                target="_blank"
                rel="noopener"
                :title="att.name || '查看原图'"
              >
                <img :src="att.url" :alt="att.name || '图片'" loading="lazy" />
              </a>
              <video
                v-else-if="att.mime?.startsWith('video/')"
                class="att-video"
                controls
                preload="metadata"
                :src="att.url"
              ></video>
              <audio v-else-if="att.type === 'audio'" class="att-audio" controls preload="metadata" :src="att.url"></audio>
              <a v-else class="att-file" :href="att.url" target="_blank" rel="noopener" :title="att.name">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>{{ att.name || '附件' }}</span>
              </a>
            </template>
          </div>

          <!-- 思考过程：正文开始前实时展开，开始后自动折叠，可手动点开 -->
          <div v-if="!isUser && message.thinking" class="think-block">
            <button class="think-head" @click="toggleThinking">
              <span class="think-icon" :class="{ 'think-icon--active': isThinking }">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </span>
              <span class="think-title">{{ isThinking ? '正在思考' : '已深度思考' }}</span>
              <span v-if="isThinking" class="think-spinner"></span>
              <svg class="think-chevron" :class="{ 'think-chevron--open': thinkingOpen }" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div v-show="thinkingOpen" class="think-body">
              <span class="think-text">{{ message.thinking }}</span><span v-if="isThinking" class="think-cursor"></span>
            </div>
          </div>

          <!-- 首个 token（含思考）到达前的纯等待：三点动画 -->
          <div v-if="!displayContent && message.streaming && !message.thinking" class="typing-dots">
            <i></i><i></i><i></i>
          </div>
          <span v-else-if="message.error" class="error-tip">生成失败，请重试</span>

          <!-- 角色设计模式优先：固定六段结构解析为炫酷角色档案卡（图文分离，立绘在气泡外图鉴区） -->
          <template v-else-if="isCharacterDesign">
            <CharacterShowcase :content="displayContent" />
            <button type="button" class="raw-toggle" @click="showRaw = !showRaw">
              {{ showRaw ? '收起原始文本' : '查看原始文本' }}
            </button>
            <div v-show="showRaw" class="bubble__content bubble__content--md" v-html="renderedHtml"></div>
          </template>

          <div
            v-else-if="displayContent"
            class="bubble__content"
            :class="{ 'bubble__content--md': !isUser }"
            v-html="renderedHtml"
            @click="onContentClick"
          ></div>

          <div
            v-else
            class="bubble__content"
            :class="{ 'bubble__content--md': !isUser }"
            v-html="renderedHtml"
            @click="onContentClick"
          ></div>

          <!-- 流式光标 -->
          <span v-if="message.streaming && displayContent" class="stream-cursor"></span>
        </div>
      </div>

      <!-- 角色设计模式：立绘图鉴（与文字档案分离的独立展示区） -->
      <div v-if="!isUser && isCharacterDesign && imageAtts.length" class="portrait-zone">
        <div class="portrait-zone__head">
          <span class="portrait-zone__badge">◈ 角色立绘</span>
          <span class="portrait-zone__line"></span>
        </div>
        <div class="portrait-zone__grid">
          <a
            v-for="(img, i) in imageAtts"
            :key="img.url"
            class="portrait-card"
            :href="img.url"
            target="_blank"
            rel="noopener"
          >
            <img :src="img.url" :alt="img.name || `角色立绘 ${i + 1}`" loading="lazy" />
            <span class="portrait-card__glow"></span>
            <span class="portrait-card__label">立绘 {{ String(i + 1).padStart(2, '0') }}</span>
          </a>
        </div>
      </div>
    </div>

    <!-- 长回复标题导航（悬浮目录） -->
    <nav v-if="showToc" class="toc-nav" aria-label="标题导航">
      <div class="toc-nav__title">目录</div>
      <button
        v-for="t in toc"
        :key="t.id"
        class="toc-nav__item"
        :class="[`toc-nav__item--h${t.level}`]"
        :title="t.text"
        @click="scrollToHeading(t.id)"
      >{{ t.text }}</button>
    </nav>
  </div>
</template>

<style scoped>
.msg-row {
  display: flex;
  gap: 12px;
  padding: 18px 0;
  animation: fadeInUp 0.3s ease;
  position: relative;
}

.msg-row--user {
  flex-direction: row-reverse;
}

/* 正文列：头像+气泡一行，立绘图鉴列在其下方（正常文档流，撑开行高），目录悬浮于列右侧 */
.msg-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.msg-line {
  display: flex;
  gap: 12px;
  min-width: 0;
}

.msg-row--user .msg-line {
  flex-direction: row-reverse;
}

/* ---- 头像 ---- */
.avatar {
  position: relative;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #1d1d1f;
  transition: transform 0.3s ease;
  overflow: hidden;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar--user {
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
  box-shadow: 0 3px 8px rgba(10, 132, 255, 0.24);
}
.avatar--streaming {
  animation: avatarPulse 1.8s ease-in-out infinite;
}
.avatar-ring {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: #0a84ff;
  animation: ringSpin 1.1s linear infinite;
}

/* 角色设计模式：原始文本折叠开关 */
.raw-toggle {
  align-self: flex-start;
  margin-top: 8px;
  padding: 3px 12px;
  font-size: 11px;
  color: #5b5bd6;
  background: rgba(91, 91, 214, 0.07);
  border: 1px solid rgba(91, 91, 214, 0.18);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.2s;
}
.raw-toggle:hover {
  background: rgba(91, 91, 214, 0.12);
}

/* 角色立绘图鉴：浅色独立分区（正常文档流，位于气泡下方） */
.portrait-zone {
  margin-left: 46px; /* 与气泡左缘对齐（34px 头像 + 12px 间距） */
  margin-top: 14px;
}
.portrait-zone__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.portrait-zone__badge {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: #86868b;
}
.portrait-zone__line {
  flex: 1;
  height: 1px;
  background: rgba(17, 24, 39, 0.08);
}
.portrait-zone__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
}
.portrait-card {
  position: relative;
  display: block;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(17, 24, 39, 0.08);
  background: #fff;
  transition: box-shadow 0.2s, transform 0.2s;
}
.portrait-card:hover {
  box-shadow: 0 12px 26px rgba(17, 24, 39, 0.12);
  transform: translateY(-2px);
}
.portrait-card img {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
.portrait-card__glow {
  display: none;
}
.portrait-card__label {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 10px;
  font-size: 11px;
  color: #fff;
  background: rgba(17, 24, 39, 0.5);
  backdrop-filter: blur(6px);
  border-radius: 999px;
}

/* ---- 气泡 ---- */
.bubble {
  max-width: min(85%, 980px);
  padding: 13px 18px;
  border-radius: 18px;
  background: transparent;
  color: #1d1d1f;
  line-height: 1.75;
  font-size: 15px;
  position: relative;
  word-break: break-word;
  transition: background 0.3s, box-shadow 0.3s;
}

.bubble--user {
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
  color: #ffffff;
  border-radius: 18px 18px 4px 18px;
  box-shadow: 0 6px 16px rgba(10, 132, 255, 0.22);
}

/* AI 回复：浅色玻璃拟态 */
.bubble:not(.bubble--user):not(.bubble--error) {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(17, 24, 39, 0.06);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03), 0 8px 24px rgba(17, 24, 39, 0.05);
  border-radius: 4px 18px 18px 18px;
}

/* 流式中的 AI 气泡：柔和的主色描边，克制不闪烁 */
.bubble--streaming {
  border-color: rgba(10, 132, 255, 0.45);
  box-shadow: 0 0 0 1px rgba(10, 132, 255, 0.08), 0 8px 24px rgba(17, 24, 39, 0.06);
}

.bubble--error {
  background: rgba(255, 235, 235, 0.8);
  border: 1px solid rgba(199, 56, 56, 0.25);
  color: #b3261e;
}

/* ---- 内容 ---- */
.bubble__content {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}
.bubble__content--md {
  white-space: normal;
}
.bubble__content--md > * + * { margin-top: 6px; }

/* ---- 多模态附件 ---- */
.bubble__atts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.bubble__atts:last-child {
  margin-bottom: 0;
}
.att-image {
  display: block;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(17, 24, 39, 0.08);
  box-shadow: 0 2px 10px rgba(17, 24, 39, 0.08);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  line-height: 0;
}
.att-image:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(17, 24, 39, 0.12);
}
.att-image img {
  max-width: min(320px, 60vw);
  max-height: 240px;
  object-fit: cover;
  display: block;
}
.att-audio {
  width: min(320px, 60vw);
  height: 36px;
  border-radius: 999px;
  outline: none;
}
.att-video {
  max-width: min(400px, 70vw);
  max-height: 300px;
  border-radius: 12px;
  display: block;
}
/* 生图工具执行中的提示胶囊 */
.img-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #0a84ff;
  padding: 4px 0 2px;
}
.img-status__spin {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid rgba(10, 132, 255, 0.2);
  border-top-color: #0a84ff;
  animation: imgSpin 0.8s linear infinite;
}
@keyframes imgSpin {
  to { transform: rotate(360deg); }
}
.att-file {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 260px;
  padding: 7px 12px;
  border-radius: 10px;
  background: rgba(91, 91, 214, 0.07);
  border: 1px solid rgba(91, 91, 214, 0.16);
  color: #5b5bd6;
  font-size: 13px;
  text-decoration: none;
  transition: background 0.15s ease;
}
.att-file:hover {
  background: rgba(91, 91, 214, 0.12);
}
.att-file span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 用户蓝色气泡里的附件微调 */
.bubble--user .att-file {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.25);
  color: #fff;
}
.bubble--user .att-file:hover {
  background: rgba(255, 255, 255, 0.28);
}

/* Markdown 样式 */
:deep(.md-h) {
  font-weight: 650;
  margin: 14px 0 8px;
  line-height: 1.4;
}
:deep(.md-h1) { font-size: 19px; color: #16161a; }
:deep(.md-h2) { font-size: 16.5px; color: #1d1d1f; }
:deep(.md-h3) { font-size: 15px; color: #2c2c30; }
/* 标题锚点跳转时预留顶部遮挡 */
:deep(.md-h) { scroll-margin-top: 60px; }

/* ---- 长回复标题导航（悬浮目录） ---- */
.toc-nav {
  position: sticky;
  top: 48px;
  align-self: flex-start;
  flex-shrink: 0;
  width: 132px;
  max-height: calc(100vh - 140px);
  overflow-y: auto;
  display: none;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(17, 24, 39, 0.06);
  box-shadow: 0 4px 16px rgba(17, 24, 39, 0.06);
}
@media (min-width: 1400px) {
  .toc-nav { display: flex; }
}
.toc-nav__title {
  font-size: 11px;
  font-weight: 700;
  color: #5b5bd6;
  letter-spacing: 2px;
  padding: 0 6px 6px;
  border-bottom: 1px solid rgba(91, 91, 214, 0.14);
  margin-bottom: 4px;
}
.toc-nav__item {
  border: none;
  background: none;
  text-align: left;
  font-size: 12px;
  line-height: 1.4;
  color: #6e6e73;
  padding: 4px 6px;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.15s;
}
.toc-nav__item:hover {
  color: #5b5bd6;
  background: rgba(91, 91, 214, 0.08);
}
.toc-nav__item--h2 { font-weight: 600; color: #2c2c30; }
.toc-nav__item--h3 { padding-left: 16px; font-size: 11.5px; }
:deep(.md-p) { margin: 4px 0; }
:deep(.md-strong) { color: #16161a; font-weight: 650; }
:deep(.md-em) { color: #43434a; font-style: italic; }
:deep(.md-inline-code) {
  display: inline-block;
  padding: 1px 6px;
  background: rgba(91, 91, 214, 0.08);
  color: #4340c0;
  border-radius: 5px;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 0.88em;
}
/* 代码卡片：浅色顶栏 + 深色内容区（沉稳对比，语法高亮清晰） */
:deep(.md-code) {
  margin: 12px 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(17, 24, 39, 0.1);
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.1);
}
:deep(.md-code__bar) {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  background: #f5f5f7;
  border-bottom: 1px solid rgba(17, 24, 39, 0.06);
}
/* macOS 三色圆点 */
:deep(.md-code__bar)::before {
  content: '';
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #ff5f57;
  box-shadow: 17px 0 0 #febc2e, 34px 0 0 #28c840;
  margin-right: 34px;
  flex-shrink: 0;
}
:deep(.md-code__lang) {
  font-size: 12px;
  color: #86868b;
  font-weight: 600;
  letter-spacing: 0.5px;
}
:deep(.md-code__copy) {
  margin-left: auto;
  font-size: 12px;
  padding: 3px 12px;
  border-radius: 8px;
  border: 1px solid rgba(17, 24, 39, 0.12);
  background: rgba(17, 24, 39, 0.04);
  color: #43434a;
  cursor: pointer;
  transition: all 0.15s;
}
:deep(.md-code__copy:hover) {
  background: rgba(17, 24, 39, 0.09);
  color: #16161a;
}
:deep(.md-code__pre) {
  margin: 0;
  padding: 12px 0;
  background: #282c34;
  color: #abb2bf;
  overflow-x: auto;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 13.5px;
  line-height: 1.7;
  counter-reset: line;
}
/* 每行一个块级 span，行号用 CSS counter 自动生成 */
:deep(.md-code__pre .cl) {
  display: block;
  padding-right: 18px;
  counter-increment: line;
}
:deep(.md-code__pre .cl::before) {
  content: counter(line);
  display: inline-block;
  width: 3em;
  padding-right: 16px;
  margin-right: 14px;
  text-align: right;
  color: #4b5263;
  user-select: none;
  -webkit-user-select: none;
}
/* 细美的滚动条 */
:deep(.md-code__pre::-webkit-scrollbar) {
  height: 8px;
}
:deep(.md-code__pre::-webkit-scrollbar-track) {
  background: transparent;
}
:deep(.md-code__pre::-webkit-scrollbar-thumb) {
  background: rgba(171, 178, 191, 0.22);
  border-radius: 4px;
}
:deep(.md-code__pre::-webkit-scrollbar-thumb:hover) {
  background: rgba(171, 178, 191, 0.38);
}
:deep(.md-code__pre code) {
  background: none;
  padding: 0;
  color: inherit;
}
/* 语法高亮配色（One Dark，与代码区 #282c34 搭配） */
:deep(.tok-kw) { color: #c678dd; font-weight: 600; }
:deep(.tok-str) { color: #98c379; }
:deep(.tok-cmt) { color: #7f848e; font-style: italic; }
:deep(.tok-num) { color: #d19a66; }
:deep(.tok-fn) { color: #61afef; }
:deep(.md-li) {
  padding-left: 20px;
  position: relative;
  margin: 3px 0;
}
:deep(.md-li::before) {
  content: '';
  position: absolute;
  left: 6px;
  top: 11px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #5b5bd6;
}
:deep(.md-li--num) { padding-left: 0; }
:deep(.md-li--num::before) { display: none; }
:deep(.md-quote) {
  padding: 6px 14px;
  margin: 8px 0;
  border-left: 3px solid #0a84ff;
  background: rgba(10, 132, 255, 0.06);
  color: #3a3a40;
  border-radius: 0 8px 8px 0;
}

/* 表格 */
:deep(.md-table) {
  width: 100%;
  margin: 10px 0;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  border: 1px solid rgba(17, 24, 39, 0.1);
  border-radius: 10px;
  overflow: hidden;
}
:deep(.md-table th) {
  padding: 8px 12px;
  background: rgba(91, 91, 214, 0.06);
  color: #4340c0;
  font-weight: 600;
  text-align: left;
  border-bottom: 1px solid rgba(17, 24, 39, 0.08);
}
:deep(.md-table td) {
  padding: 7px 12px;
  color: #3a3a40;
  border-bottom: 1px solid rgba(17, 24, 39, 0.06);
}
:deep(.md-table tbody tr:last-child td) { border-bottom: none; }
:deep(.md-table tbody tr:hover td) { background: rgba(91, 91, 214, 0.04); }

/* 分隔线 */
:deep(.md-hr) {
  border: none;
  height: 1px;
  margin: 14px 0;
  background: rgba(17, 24, 39, 0.1);
}

/* 链接 / 删除线 */
:deep(.md-link) {
  color: #0a84ff;
  text-decoration: none;
  border-bottom: 1px dashed rgba(10, 132, 255, 0.4);
  transition: color 0.15s, border-color 0.15s;
}
:deep(.md-link:hover) { color: #0055cc; border-bottom-style: solid; }
:deep(.md-del) { color: #a9a9ad; }

/* ---- 流式光标 ---- */
.stream-cursor {
  display: inline-block;
  width: 2.5px;
  height: 1.1em;
  margin-left: 3px;
  vertical-align: text-bottom;
  border-radius: 2px;
  background: #0a84ff;
  animation: cursorPulse 0.9s ease-in-out infinite;
}

/* ---- 思考过程折叠区 ---- */
.think-block {
  margin-bottom: 10px;
  border-radius: 11px;
  background: rgba(91, 91, 214, 0.04);
  border: 1px solid rgba(91, 91, 214, 0.12);
  overflow: hidden;
}
.think-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #5b5bd6;
  transition: background 0.2s ease;
}
.think-head:hover { background: rgba(91, 91, 214, 0.06); }
.think-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #86868b;
  transition: color 0.3s ease;
}
.think-icon--active {
  color: #5b5bd6;
  animation: thinkBolt 1.4s ease-in-out infinite;
}
.think-title { line-height: 1; }
.think-spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.8px solid rgba(91, 91, 214, 0.2);
  border-top-color: #5b5bd6;
  animation: ringSpin 0.8s linear infinite;
}
.think-chevron {
  margin-left: auto;
  color: #86868b;
  transition: transform 0.25s ease;
}
.think-chevron--open { transform: rotate(180deg); }
.think-body {
  padding: 2px 12px 10px 12px;
  max-height: 220px;
  overflow-y: auto;
}
.think-text {
  font-size: 13px;
  line-height: 1.7;
  color: #86868b;
  white-space: pre-wrap;
  word-break: break-word;
}
.think-cursor {
  display: inline-block;
  width: 2px;
  height: 0.95em;
  margin-left: 2px;
  vertical-align: text-bottom;
  border-radius: 1px;
  background: #5b5bd6;
  animation: cursorPulse 0.9s ease-in-out infinite;
}

/* ---- 打字等待点 ---- */
.typing-dots {
  display: inline-flex;
  gap: 5px;
  padding: 6px 2px;
}
.typing-dots i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #a9a9ad;
  animation: dotBounce 1.3s infinite ease-in-out;
}
.typing-dots i:nth-child(2) { animation-delay: 0.18s; }
.typing-dots i:nth-child(3) { animation-delay: 0.36s; }

.error-tip {
  font-size: 13px;
  color: #b3261e;
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes cursorPulse {
  0%, 100% { opacity: 1; transform: scaleY(1); }
  50% { opacity: 0.4; transform: scaleY(0.7); }
}
@keyframes dotBounce {
  0%, 80%, 100% { transform: translateY(0) scale(0.7); opacity: 0.5; }
  40% { transform: translateY(-4px) scale(1); opacity: 1; }
}
@keyframes avatarPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
@keyframes ringSpin {
  to { transform: rotate(360deg); }
}
@keyframes thinkBolt {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}
</style>