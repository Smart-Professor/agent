<script setup lang="ts">
/**
 * 角色设计展示卡（克制的浅色版本）：
 * - three.js 只用在顶部姓名区的柔和星云背景（Showcase3D），不上页面背景
 * - 轻量拾取灯效、轻盈的 3D 倾斜，其余保持干净朴素
 */
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import Showcase3D from './Showcase3D.vue'

const props = defineProps<{
  content: string
  images?: { url: string; name?: string }[]
}>()

/** 按 "## " 切分并建立 标题→正文 索引（兼容流式未完成时缺段） */
const sections = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  const parts = props.content.split(/^##\s*/m)
  for (const p of parts) {
    const nl = p.indexOf('\n')
    if (nl < 0) continue
    const title = p.slice(0, nl).trim()
    if (title) map[title] = p.slice(nl + 1).trim()
  }
  return map
})

const secBase = computed(() => pick(['一、角色基础信息', '角色基础信息']))
const secLook = computed(() => pick(['二、外貌设计', '外貌设计']))
const secCore = computed(() => pick(['三、性格与人物内核', '性格与人物内核']))
const secStory = computed(() => pick(['四、剧情背景故事', '剧情背景故事']))
const secVisual = computed(() => pick(['五、视觉方案', '视觉方案']))
const secSlogan = computed(() => pick(['六、一句话角色slogan', '一句话角色slogan', '六、一句话角色 slogan']))

function pick(titles: string[]): string {
  for (const t of titles) {
    for (const k of Object.keys(sections.value)) {
      if (k.startsWith(t) || t.startsWith(k)) return sections.value[k]
    }
  }
  return ''
}

function field(text: string, key: string): string {
  const re = new RegExp(`(?:^|\\\n)[^\\\n]*?${key}[^：:]*[：:]\\s*([^\\\n]+)`)
  const m = text.match(re)
  return m ? m[1].replace(/\*\*/g, '').trim() : ''
}

const charName = computed(() => {
  const raw = field(secBase.value, '姓名')
  const m = raw.match(/([^（(/|]+)(?:（推荐）)?/)
  return (m?.[1] || raw || '未命名角色').trim()
})

const charAge = computed(() => field(secBase.value, '年龄'))
const charRole = computed(() => field(secBase.value, '身份'))

const tags = computed(() => {
  const raw = field(secBase.value, '标签')
  if (!raw) return []
  return raw
    .replace(/[\["\]]/g, '')
    .split(/[、,，;；]|(?<=\S)\s(?=\S)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 20)
    .slice(0, 4)
})

const palette = computed(() => {
  const hexes = [...new Set(secVisual.value.match(/#[0-9a-fA-F]{6}\b/g) || [])]
  return hexes.slice(0, 6)
})

const drawingPrompt = computed(() => {
  const m = secVisual.value.match(/绘图提示词[^\n]*[：:]\s*([\s\S]+)$/)
  return (m?.[1] || '').trim()
})

const coreTraits = computed(() =>
  ([
    ['表面性格', '🎭'],
    ['真实性格', '🌑'],
    ['核心欲望', '🔥'],
    ['恐惧', '⚡'],
    ['致命弱点', '💔'],
  ] as const)
    .map(([k, icon]) => ({ k, icon, v: field(secCore.value, k) }))
    .filter((t) => t.v),
)

const lookItems = computed(() => {
  const items = ([
    ['五官', '👤'],
    ['穿搭', '👘'],
    ['记忆点', '✨'],
  ] as const)
    .map(([k, icon]) => ({ k, icon, v: field(secLook.value, k) }))
    .filter((t) => t.v)
  return items.length
    ? items
    : secLook.value
      ? [{ k: '外貌设计', icon: '👤', v: secLook.value.replace(/^-+\s*/gm, '') }]
      : []
})

const storyItems = computed(() =>
  ([
    ['出身', '🌱'],
    ['关键经历', '⚔️'],
    ['隐藏秘密', '🔐'],
    ['人物关系', '🔗'],
    ['反转', '🌀'],
    ['弧光', '🌌'],
  ] as const)
    .map(([k, icon]) => ({ k, icon, v: field(secStory.value, k) }))
    .filter((t) => t.v),
)

const slogan = computed(() => secSlogan.value.replace(/^[-*>\s]+/, '').split('\n')[0] || '')

function clean(text: string): string {
  return text.replace(/\*\*/g, '').replace(/^-\s*/, '').trim()
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(drawingPrompt.value)
    ElMessage.success('绘图提示词已复制')
  } catch {
    ElMessage.error('复制失败，请手动选择文本')
  }
}

/* ---- 轻盈的 3D 倾斜（仅顶部） ---- */
const headEl = ref<HTMLElement | null>(null)

function onHeadMove(e: MouseEvent) {
  const el = headEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width - 0.5
  const y = (e.clientY - rect.top) / rect.height - 0.5
  el.style.transform = `perspective(900px) rotateX(${(-y * 3).toFixed(2)}deg) rotateY(${(x * 4).toFixed(2)}deg)`
  el.style.setProperty('--hx', `${((x + 0.5) * 100).toFixed(1)}%`)
  el.style.setProperty('--hy', `${((y + 0.5) * 100).toFixed(1)}%`)
}
function onHeadLeave() {
  const el = headEl.value
  if (!el) return
  el.style.transform = 'perspective(900px) rotateX(0) rotateY(0)'
  el.style.setProperty('--hx', '50%')
  el.style.setProperty('--hy', '50%')
}

/* ---- Canvas 雷达图（浅色） ---- */
const radarCanvas = ref<HTMLCanvasElement | null>(null)
let rafId = 0

function estimateIntensity(text: string): number {
  if (!text) return 0
  const strong = ['极', '非常', '强烈', '深厚', '核心', '致命', '深刻', '坚定', '执着', '狂热']
  const medium = ['较', '有些', '明显', '一定', '尚', '颇']
  let score = 50
  for (const w of strong) if (text.includes(w)) score += 15
  for (const w of medium) if (text.includes(w)) score += 8
  score += Math.min(text.length / 4, 25)
  return Math.min(95, Math.max(30, score))
}

const radarData = computed(() => {
  const traits = ['表面性格', '真实性格', '核心欲望', '恐惧', '致命弱点']
  return traits
    .map((t) => ({ label: t, value: estimateIntensity(field(secCore.value, t)) }))
    .filter((d) => d.value > 0)
})

const ACCENT = { rgb: '91, 91, 214', rgba: 'rgba(91, 91, 214' }

function drawRadar(timestamp = Date.now()) {
  const canvas = radarCanvas.value
  if (!canvas || radarData.value.length < 3) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const size = 200
  canvas.width = size * dpr
  canvas.height = size * dpr
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`
  ctx.scale(dpr, dpr)
  const cx = size / 2
  const cy = size / 2
  const radius = 72
  const n = radarData.value.length
  const angleStep = (Math.PI * 2) / n
  const startAngle = -Math.PI / 2

  ctx.clearRect(0, 0, size, size)

  // 背景网格圈（浅灰）
  for (let ring = 1; ring <= 4; ring++) {
    const r = (radius / 4) * ring
    ctx.beginPath()
    for (let i = 0; i <= n; i++) {
      const a = startAngle + angleStep * i
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = ring === 4 ? `${ACCENT.rgba}, 0.35)` : `${ACCENT.rgba}, 0.14)`
    ctx.lineWidth = ring === 4 ? 1.2 : 0.8
    ctx.stroke()
  }

  // 轴线
  for (let i = 0; i < n; i++) {
    const a = startAngle + angleStep * i
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius)
    ctx.strokeStyle = `${ACCENT.rgba}, 0.14)`
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  const progress = Math.min(1, (timestamp - radarStart) / 800)
  const eased = 1 - Math.pow(1 - progress, 3)

  // 数据多边形
  ctx.beginPath()
  for (let i = 0; i <= n; i++) {
    const idx = i % n
    const a = startAngle + angleStep * idx
    const r = (radarData.value[idx].value / 100) * radius * eased
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  grad.addColorStop(0, `${ACCENT.rgba}, 0.2)`)
  grad.addColorStop(1, `${ACCENT.rgba}, 0.05)`)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.strokeStyle = ACCENT.rgba + ', 0.7)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 顶点
  for (let i = 0; i < n; i++) {
    const a = startAngle + angleStep * i
    const r = (radarData.value[i].value / 100) * radius * eased
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fillStyle = `rgb(${ACCENT.rgb})`
    ctx.fill()
  }

  // 标签
  ctx.font = '11px -apple-system, "PingFang SC", sans-serif'
  ctx.fillStyle = '#6e6e73'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < n; i++) {
    const a = startAngle + angleStep * i
    const lx = cx + Math.cos(a) * (radius + 16)
    const ly = cy + Math.sin(a) * (radius + 16)
    ctx.fillText(radarData.value[i].label, lx, ly)
  }

  if (progress < 1) rafId = requestAnimationFrame((ts) => drawRadar(ts || timestamp))
}

let radarStart = 0
function startRadar() {
  cancelAnimationFrame(rafId)
  radarStart = Date.now()
  nextTick(() => { rafId = requestAnimationFrame(() => drawRadar()) })
}

watch(radarData, () => { if (radarData.value.length >= 3) startRadar() })
onMounted(() => { if (radarData.value.length >= 3) startRadar() })
onBeforeUnmount(() => cancelAnimationFrame(rafId))
</script>

<template>
  <div class="cs">
    <!-- 顶部：姓名区（浅色，three.js 星云作背景） -->
    <div
      ref="headEl"
      class="cs__head"
      @mousemove="onHeadMove"
      @mouseleave="onHeadLeave"
    >
      <Showcase3D />
      <div class="cs__head-inner">
        <span class="cs__eyebrow">角色档案</span>
        <h2 class="cs__name">{{ charName }}</h2>
        <div class="cs__meta">
          <span v-if="charAge" class="cs__pill">{{ charAge }}</span>
          <span v-if="charRole" class="cs__pill">{{ charRole }}</span>
          <span v-for="t in tags" :key="t" class="cs__pill cs__pill--tag"># {{ t }}</span>
        </div>
      </div>
      <p v-if="slogan" class="cs__slogan">「{{ slogan }}」</p>
    </div>

    <!-- 立绘 -->
    <div v-if="images?.length" class="cs__gallery">
      <a
        v-for="(img, i) in images"
        :key="img.url"
        class="cs__figure"
        :href="img.url"
        target="_blank"
        rel="noopener"
      >
        <img :src="img.url" :alt="img.name || `角色立绘 ${i + 1}`" loading="lazy" />
        <span class="cs__figure-cap">立绘 {{ i + 1 }}</span>
      </a>
    </div>

    <!-- 雷达图 -->
    <section v-if="radarData.length >= 3" class="cs__block cs__block--radar">
      <h3 class="cs__title"><span class="cs__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></span>角色属性雷达</h3>
      <div class="cs__radar-wrap">
        <canvas ref="radarCanvas" class="cs__radar"></canvas>
      </div>
    </section>

    <!-- 各部分 -->
    <section v-if="lookItems.length" class="cs__block cs__block--look">
      <h3 class="cs__title"><span class="cs__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>外貌设计</h3>
      <dl v-for="it in lookItems" :key="it.k" class="cs__row">
        <dt>{{ it.icon }} {{ it.k }}</dt>
        <dd>{{ clean(it.v) }}</dd>
      </dl>
    </section>

    <section v-if="coreTraits.length" class="cs__block cs__block--core">
      <h3 class="cs__title"><span class="cs__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></span>性格与人物内核</h3>
      <dl v-for="t in coreTraits" :key="t.k" class="cs__row">
        <dt>{{ t.icon }} {{ t.k }}</dt>
        <dd>{{ clean(t.v) }}</dd>
      </dl>
    </section>

    <section v-if="storyItems.length" class="cs__block cs__block--story">
      <h3 class="cs__title"><span class="cs__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg></span>剧情背景故事</h3>
      <dl v-for="it in storyItems" :key="it.k" class="cs__row">
        <dt>{{ it.icon }} {{ it.k }}</dt>
        <dd>{{ clean(it.v) }}</dd>
      </dl>
    </section>

    <section v-if="secVisual" class="cs__block cs__block--visual">
      <h3 class="cs__title"><span class="cs__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg></span>视觉方案</h3>
      <div v-if="palette.length" class="cs__palette">
        <div v-for="c in palette" :key="c" class="cs__swatch">
          <span class="cs__dot" :style="{ background: c }"></span>
          <span class="cs__hex">{{ c }}</span>
        </div>
      </div>
      <p class="cs__text">{{ clean(secVisual.replace(/绘图提示词[\s\S]*$/, '')) }}</p>
      <div v-if="drawingPrompt" class="cs__prompt">
        <div class="cs__prompt-bar">
          <span>⚡ 绘图提示词</span>
          <button type="button" class="cs__copy" @click="copyPrompt">复制</button>
        </div>
        <p class="cs__prompt-body">{{ drawingPrompt }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cs {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: #1d1d1f;
}

/* ---- 顶部姓名区：浅色 + three.js 星云 + 轻盈 3D 倾斜 ---- */
.cs__head {
  --hx: 50%;
  --hy: 50%;
  position: relative;
  padding: 26px 26px 22px;
  border-radius: 18px;
  background: linear-gradient(
    150deg,
    rgba(255, 255, 255, 0.96) 0%,
    rgba(240, 242, 252, 0.92) 55%,
    rgba(229, 233, 250, 0.9) 100%
  );
  border: 1px solid rgba(17, 24, 39, 0.07);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 10px 30px rgba(17, 24, 39, 0.05);
  overflow: hidden;
  transform-style: preserve-3d;
  transition: transform 0.18s ease-out;
  will-change: transform;
}
/* 一层极淡的鼠标跟随柔光，克制地出现 */
.cs__head::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle 200px at var(--hx, 50%) var(--hy, 50%), rgba(91, 91, 214, 0.07), transparent 70%);
  pointer-events: none;
}
.cs__head-inner {
  position: relative;
  z-index: 2;
}
.cs__eyebrow {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: #86868b;
  text-transform: uppercase;
}
.cs__name {
  position: relative;
  margin: 8px 0 14px;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #16161a;
  line-height: 1.15;
}
.cs__meta {
  position: relative;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.cs__pill {
  padding: 4px 13px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  color: #43434a;
  background: rgba(17, 24, 39, 0.05);
  border: 1px solid rgba(17, 24, 39, 0.06);
}
.cs__pill--tag {
  color: #5b5bd6;
  background: rgba(91, 91, 214, 0.07);
  border-color: rgba(91, 91, 214, 0.14);
}
.cs__slogan {
  position: relative;
  margin: 16px 0 0;
  font-size: 14px;
  color: #5b5bd6;
  font-style: italic;
}

/* ---- 立绘图卡 ---- */
.cs__gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
}
.cs__figure {
  position: relative;
  display: block;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(17, 24, 39, 0.07);
  background: #fff;
  transition: box-shadow 0.25s, transform 0.25s;
}
.cs__figure:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 30px rgba(17, 24, 39, 0.12);
}
.cs__figure img {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
.cs__figure-cap {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 10px;
  font-size: 11px;
  color: #fff;
  background: rgba(17, 24, 39, 0.55);
  backdrop-filter: blur(6px);
  border-radius: 999px;
}

/* ---- 通用内容块：按板块分色的卡片（一眼区分各个部分） ---- */
.cs__block {
  --accent: #5b5bd6;
  --accent-2: #8181ea;
  --accent-soft: rgba(91, 91, 214, 0.08);
  position: relative;
  padding: 18px 20px 20px;
  border-radius: 14px;
  background:
    linear-gradient(180deg, var(--accent-soft) 0%, rgba(255, 255, 255, 0) 58px),
    rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(17, 24, 39, 0.07);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03), 0 6px 18px rgba(17, 24, 39, 0.04);
  overflow: hidden;
  transition: box-shadow 0.25s, transform 0.25s, border-color 0.25s;
}
/* 左侧主题色竖条：最强的“分区”信号 */
.cs__block::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, var(--accent), var(--accent-2));
}
.cs__block:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 26%, transparent);
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03), 0 14px 30px rgba(17, 24, 39, 0.08);
}

.cs__title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 14px;
  padding-bottom: 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
  letter-spacing: 0.02em;
}
.cs__ico {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: #fff;
  background: var(--accent);
  box-shadow: 0 5px 12px color-mix(in srgb, var(--accent) 34%, transparent);
}
.cs__ico svg {
  width: 15px;
  height: 15px;
  display: block;
}
/* 各区块一个主题色：竖条、标题、图标底色、条目徽标统一 */
.cs__block--radar  { --accent: #5b5bd6; --accent-2: #8181ea; --accent-soft: rgba(91, 91, 214, 0.085); }
.cs__block--look   { --accent: #0a84ff; --accent-2: #4aa6ff; --accent-soft: rgba(10, 132, 255, 0.085); }
.cs__block--core   { --accent: #c7297f; --accent-2: #e0559d; --accent-soft: rgba(199, 41, 127, 0.085); }
.cs__block--story  { --accent: #1a9e57; --accent-2: #3ec27e; --accent-soft: rgba(26, 158, 87, 0.085); }
.cs__block--visual { --accent: #d98a1f; --accent-2: #f0ab45; --accent-soft: rgba(217, 138, 31, 0.095); }

.cs__row {
  margin: 0 0 12px;
}
.cs__row:last-child {
  margin-bottom: 0;
}
.cs__row dt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 650;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
}
.cs__row dd {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.78;
  color: #3a3a40;
}

/* 外貌 / 内核 / 剧情：条目横排成小卡，结构上也与雷达区一眼可分 */
.cs__block--look,
.cs__block--core,
.cs__block--story {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
  align-items: start;
}
.cs__block--look > .cs__title,
.cs__block--core > .cs__title,
.cs__block--story > .cs__title {
  grid-column: 1 / -1;
}
.cs__block--look > .cs__row,
.cs__block--core > .cs__row,
.cs__block--story > .cs__row {
  margin: 0;
  padding: 12px 14px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid color-mix(in srgb, var(--accent) 15%, rgba(17, 24, 39, 0.06));
}

/* ---- 色板 ---- */
.cs__palette {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.cs__swatch {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px 4px 5px;
  border-radius: 999px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  background: rgba(17, 24, 39, 0.03);
  transition: transform 0.2s;
}
.cs__swatch:hover {
  transform: scale(1.05);
}
.cs__dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(17, 24, 39, 0.1);
}
.cs__hex {
  font-size: 11px;
  font-family: ui-monospace, 'SF Mono', monospace;
  color: #6e6e73;
}
.cs__text {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 1.75;
  white-space: pre-wrap;
  color: #3a3a40;
}

/* ---- 提示词块：浅色代码风 ---- */
.cs__prompt {
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.03);
  overflow: hidden;
}
.cs__prompt-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  font-size: 11.5px;
  color: #5b5bd6;
  font-weight: 600;
  border-bottom: 1px solid rgba(17, 24, 39, 0.07);
}
.cs__copy {
  padding: 3px 14px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: #16161a;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.2s;
}
.cs__copy:hover {
  opacity: 0.85;
  transform: scale(1.03);
}
.cs__prompt-body {
  margin: 0;
  padding: 12px 14px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #3a3a40;
  font-family: ui-monospace, 'SF Mono', monospace;
  word-break: break-word;
  max-height: 150px;
  overflow-y: auto;
}

/* ---- 雷达图容器 ---- */
.cs__radar-wrap {
  display: flex;
  justify-content: center;
  padding: 4px 0;
}
.cs__radar {
  display: block;
}
</style>