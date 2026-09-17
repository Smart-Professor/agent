<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, Document } from '@element-plus/icons-vue'
import { listFiles, uploadFile, downloadBlob, removeFile, type DriveItem } from '@/api/r2'
import { apiError } from '@/api/http'
import { formatBytes, formatTime } from '@/utils/format'

const items = ref<DriveItem[]>([])
const loading = ref(false)
const uploading = ref(false)
const progress = ref(0)
/** 视图模式：grid=卡片，list=表格列表 */
const viewMode = ref<'grid' | 'list'>('grid')

/** 按扩展名给文件卡片选个图标与配色 */
function fileVisual(name: string): { icon: string; tint: string; color: string } {
  const ext = (name.split('.').pop() || '').toLowerCase()
  const map: Record<string, { icon: string; tint: string; color: string }> = {
    pdf: { icon: '📕', tint: '#fef2f2', color: '#dc2626' },
    doc: { icon: '📘', tint: '#eff6ff', color: '#2563eb' },
    docx: { icon: '📘', tint: '#eff6ff', color: '#2563eb' },
    xls: { icon: '📗', tint: '#f0fdf4', color: '#16a34a' },
    xlsx: { icon: '📗', tint: '#f0fdf4', color: '#16a34a' },
    ppt: { icon: '📙', tint: '#fff7ed', color: '#ea580c' },
    pptx: { icon: '📙', tint: '#fff7ed', color: '#ea580c' },
    zip: { icon: '🗜️', tint: '#faf5ff', color: '#9333ea' },
    rar: { icon: '🗜️', tint: '#faf5ff', color: '#9333ea' },
    '7z': { icon: '🗜️', tint: '#faf5ff', color: '#9333ea' },
    png: { icon: '🖼️', tint: '#ecfeff', color: '#0891b2' },
    jpg: { icon: '🖼️', tint: '#ecfeff', color: '#0891b2' },
    jpeg: { icon: '🖼️', tint: '#ecfeff', color: '#0891b2' },
    gif: { icon: '🖼️', tint: '#ecfeff', color: '#0891b2' },
    webp: { icon: '🖼️', tint: '#ecfeff', color: '#0891b2' },
    mp4: { icon: '🎬', tint: '#fdf2f8', color: '#db2777' },
    mp3: { icon: '🎵', tint: '#fdf2f8', color: '#db2777' },
    txt: { icon: '📄', tint: '#f9fafb', color: '#6b7280' },
    md: { icon: '📝', tint: '#f9fafb', color: '#6b7280' },
  }
  return map[ext] ?? { icon: '📦', tint: '#eef2ff', color: '#4f46e5' }
}

async function load() {
  loading.value = true
  try {
    items.value = await listFiles()
    // 图片卡片后台加载缩略图（不阻塞列表渲染）
    for (const row of items.value) {
      if (isImageName(row.name)) ensureThumb(row)
    }
  } catch (e) {
    ElMessage.error(apiError(e) || '加载文件列表失败')
  } finally {
    loading.value = false
  }
}

/* ---- 图片缩略图 ---- */
const thumbUrls = ref<Record<string, string>>({})
const thumbFailed = ref<Record<string, boolean>>({})

function isImageName(name: string): boolean {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
}

/** 拉取图片生成 blob URL 作为缩略图；失败则回退为图标 */
async function ensureThumb(row: DriveItem) {
  if (thumbUrls.value[row.key] || thumbFailed.value[row.key]) return
  try {
    const blob = await downloadBlob(row.key)
    thumbUrls.value[row.key] = URL.createObjectURL(blob)
  } catch {
    thumbFailed.value[row.key] = true
  }
}

onMounted(load)

// el-upload 自定义上传（后端落库共享网盘记录，所有登录用户可见）
async function customUpload(option: any) {
  const file = option.file as File
  uploading.value = true
  progress.value = 0
  try {
    await uploadFile(file, (percent: number) => {
      progress.value = percent
    })
    option.onSuccess({})
    ElMessage.success('上传成功')
    await load()
  } catch (e) {
    option.onError(e as Error)
    ElMessage.error(apiError(e) || '上传失败')
  } finally {
    uploading.value = false
    progress.value = 0
  }
}

async function handleDownload(row: DriveItem) {
  try {
    const blob = await downloadBlob(row.key)
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = row.name
    a.click()
    URL.revokeObjectURL(blobUrl)
  } catch (e) {
    ElMessage.error(apiError(e) || '下载失败')
  }
}

/* ---- 文件预览 ---- */
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unsupported'

const previewVisible = ref(false)
const previewLoading = ref(false)
const previewRow = ref<DriveItem | null>(null)
const previewKind = ref<PreviewKind>('unsupported')
const previewUrl = ref('')
const previewText = ref('')

/** 按扩展名判定预览方式 */
function detectPreviewKind(name: string): PreviewKind {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio'
  if (ext === 'pdf') return 'pdf'
  if (['txt', 'md', 'json', 'csv', 'xml', 'html', 'css', 'js', 'ts', 'log', 'yml', 'yaml'].includes(ext)) return 'text'
  return 'unsupported'
}

/** 关闭预览时释放 blob URL，避免内存泄漏 */
function closePreview() {
  previewVisible.value = false
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
  previewRow.value = null
  previewText.value = ''
}

/** 点击卡片预览：媒体/PDF/文本直接展示，其它类型引导下载或新窗口打开 */
async function openPreview(row: DriveItem) {
  const kind = detectPreviewKind(row.name)
  previewRow.value = row
  previewKind.value = kind
  previewText.value = ''
  previewUrl.value = ''
  previewVisible.value = true

  if (kind === 'unsupported') return

  previewLoading.value = true
  try {
    // R2 公开域名不带 CORS 头，预览统一走后端代理拿 blob，再用 blob URL 渲染
    const blob = await downloadBlob(row.key)
    previewUrl.value = URL.createObjectURL(blob)
    if (kind === 'text') {
      previewText.value = (await blob.text()).slice(0, 200000) // 超大文本截断
    }
  } catch (e) {
    ElMessage.error(apiError(e) || '加载预览失败')
    previewKind.value = 'unsupported'
  } finally {
    previewLoading.value = false
  }
}

/** 在新标签页打开（后端代理流，携带登录态通过 blob 中转） */
async function openInNewTab(row: DriveItem) {
  try {
    const blob = await downloadBlob(row.key)
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (e) {
    ElMessage.error(apiError(e) || '打开失败')
  }
}

const previewTitle = computed(() =>
  previewRow.value ? `预览 · ${previewRow.value.name}` : '预览',
)

async function handleDelete(row: DriveItem) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${row.name}」？删除后所有用户将无法访问。`,
      '删除文件',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消
  }
  try {
    await removeFile(row.key)
    // 释放并清理该文件的缩略图
    if (thumbUrls.value[row.key]) {
      URL.revokeObjectURL(thumbUrls.value[row.key])
      delete thumbUrls.value[row.key]
    }
    items.value = items.value.filter((i) => i.key !== row.key)
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(apiError(e) || '删除失败')
  }
}
</script>

<template>
  <div class="storage">
    <header class="storage__header">
      <h2 class="storage__title">共享网盘</h2>
      <p class="storage__sub">基于 Cloudflare R2 的团队共享空间 · 登录用户均可查看与下载，仅上传者可删除</p>
    </header>

    <div class="card" v-loading="uploading">
      <el-upload
        drag
        :show-file-list="false"
        :http-request="customUpload"
        :disabled="uploading"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
      </el-upload>
      <el-progress
        v-if="uploading"
        :percentage="progress"
        style="margin-top: 16px"
      />
    </div>

    <div class="card" v-loading="loading">
      <div class="card-header">
        <div class="card-header__left">
          <span class="card-title">全部文件</span>
          <el-tag size="small" type="info">{{ items.length }} 个文件</el-tag>
        </div>
        <!-- 列表 / 卡片 视图切换 -->
        <div class="view-switch" role="group" aria-label="视图切换">
          <button
            class="view-switch__btn"
            :class="{ active: viewMode === 'grid' }"
            @click="viewMode = 'grid'"
            title="卡片视图"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="3" width="7" height="7" rx="1.5"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
          </button>
          <button
            class="view-switch__btn"
            :class="{ active: viewMode === 'list' }"
            @click="viewMode = 'list'"
            title="列表视图"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M8 6h13M8 12h13M8 18h13"/>
              <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 卡片视图 -->
      <div v-if="viewMode === 'grid'" class="file-grid">
        <div v-for="row in items" :key="row.key" class="file-card" @click="openPreview(row)" title="点击预览">
          <div
            v-if="isImageName(row.name) && thumbUrls[row.key]"
            class="file-card__thumb"
          >
            <img :src="thumbUrls[row.key]" :alt="row.name" loading="lazy" />
          </div>
          <div v-else class="file-card__icon" :style="{ background: fileVisual(row.name).tint, color: fileVisual(row.name).color }">
            <span class="file-card__emoji">{{ fileVisual(row.name).icon }}</span>
          </div>
          <div class="file-card__body">
            <div class="file-card__name" :title="row.name">{{ row.name }}</div>
            <div class="file-card__meta">
              <span>{{ formatBytes(row.size) }}</span>
              <span class="dot">·</span>
              <span :class="{ 'me-tag': row.mine }">{{ row.mine ? '我' : row.uploaderName }}</span>
              <span class="dot">·</span>
              <span>{{ formatTime(row.createdAt) }}</span>
            </div>
            <div class="file-card__actions">
              <el-button link type="primary" size="small" @click.stop="handleDownload(row)">下载</el-button>
              <el-button
                v-if="row.url"
                link
                type="primary"
                size="small"
                tag="a"
                :href="row.url"
                target="_blank"
                @click.stop
              >访问链接</el-button>
              <el-button v-if="row.mine" link type="danger" size="small" @click.stop="handleDelete(row)">删除</el-button>
            </div>
          </div>
        </div>
        <div v-if="!items.length && !loading" class="grid-empty">网盘暂无文件，上传一个试试</div>
      </div>

      <!-- 列表视图（原表格） -->
      <el-table v-else :data="items" stripe empty-text="网盘暂无文件，上传一个试试">
        <el-table-column label="文件名" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="file-name">
              <el-icon class="file-icon"><Folder v-if="row.type" style="display:none" /><Document /></el-icon>
              {{ row.name }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="110">
          <template #default="{ row }">{{ formatBytes(row.size) }}</template>
        </el-table-column>
        <el-table-column label="上传者" width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag v-if="row.mine" size="small" type="success" effect="plain">我</el-tag>
            <span class="uploader">{{ row.uploaderName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="上传时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleDownload(row)">下载</el-button>
            <el-button
              v-if="row.url"
              link
              type="primary"
              tag="a"
              :href="row.url"
              target="_blank"
            >访问链接</el-button>
            <el-button v-if="row.mine" link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 文件预览对话框 -->
    <el-dialog
      v-model="previewVisible"
      :title="previewTitle"
      width="720px"
      :destroy-on-close="true"
      @close="closePreview"
      class="preview-dialog"
    >
      <div v-loading="previewLoading" class="preview-body">
        <!-- 不支持内嵌预览的类型：引导下载 / 新窗口打开 -->
        <template v-if="previewKind === 'unsupported'">
          <div class="preview-unsupported">
            <span class="preview-unsupported__icon">{{ previewRow ? fileVisual(previewRow.name).icon : '📦' }}</span>
            <p class="preview-unsupported__title">该文件类型暂不支持在线预览</p>
            <p v-if="previewRow" class="preview-unsupported__meta">
              {{ previewRow.name }} · {{ formatBytes(previewRow.size) }}
            </p>
            <div class="preview-unsupported__actions">
              <el-button type="primary" @click="previewRow && handleDownload(previewRow)">下载文件</el-button>
              <el-button v-if="previewRow" @click="previewRow && openInNewTab(previewRow)">新窗口打开</el-button>
            </div>
          </div>
        </template>

        <!-- 图片 -->
        <img
          v-else-if="previewKind === 'image' && previewUrl"
          :src="previewUrl"
          class="preview-image"
          :alt="previewRow?.name"
        />

        <!-- 视频 -->
        <video v-else-if="previewKind === 'video' && previewUrl" :src="previewUrl" controls class="preview-media" />

        <!-- 音频 -->
        <audio v-else-if="previewKind === 'audio' && previewUrl" :src="previewUrl" controls class="preview-audio" />

        <!-- PDF / 其它浏览器可渲染文档：iframe 内嵌 -->
        <iframe
          v-else-if="(previewKind === 'pdf') && previewUrl"
          :src="previewUrl"
          class="preview-iframe"
          :title="previewRow?.name"
        />

        <!-- 文本类 -->
        <pre v-else-if="previewKind === 'text' && previewUrl" class="preview-text">{{ previewText }}</pre>

        <!-- 加载兜底 -->
        <div v-else class="preview-placeholder">正在加载预览…</div>
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button v-if="previewRow" @click="previewRow && openInNewTab(previewRow)">新窗口打开</el-button>
        <el-button v-if="previewRow" type="primary" @click="previewRow && handleDownload(previewRow)">下载</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.storage {
  height: 100%;
  overflow-y: auto;
  padding: 28px 24px 48px;
}

.storage__header {
  max-width: 980px;
  margin: 0 auto 20px;
}
.storage__title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.01em;
}
.storage__sub {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
}

.card {
  max-width: 980px;
  margin: 0 auto 20px;
  padding: 20px 22px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(31, 41, 55, 0.07);
  border-radius: 18px;
  box-shadow: 0 4px 18px rgba(31, 41, 55, 0.05);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.card-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ---- 列表 / 卡片 视图切换按钮组 ---- */
.view-switch {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: rgba(31, 41, 55, 0.05);
  border-radius: 9px;
}
.view-switch__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.18s ease;
}
.view-switch__btn:hover {
  color: #374151;
  background: rgba(31, 41, 55, 0.06);
}
.view-switch__btn.active {
  background: #fff;
  color: #4f46e5;
  box-shadow: 0 1px 4px rgba(31, 41, 55, 0.12);
}

/* ---- 卡片视图 ---- */
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.file-card {
  display: flex;
  gap: 12px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(31, 41, 55, 0.07);
  border-radius: 14px;
  transition: all 0.2s ease;
}
.file-card:hover {
  border-color: rgba(99, 102, 241, 0.4);
  box-shadow: 0 6px 18px rgba(79, 70, 229, 0.1);
  transform: translateY(-2px);
}
.file-card__icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}

/* 图片缩略图：占据卡片上部，等比裁剪 */
.file-card__thumb {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 12px;
  overflow: hidden;
  background: #f3f4f6;
}
.file-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.file-card__body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.file-card__name {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-card__meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #6b7280;
  overflow: hidden;
  white-space: nowrap;
}
.file-card__meta .dot {
  color: #d1d5db;
}
.me-tag {
  color: #16a34a;
  font-weight: 600;
}
.file-card__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
}
.grid-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  padding: 28px 0;
}

/* 可点击预览的卡片手势提示 */
.file-card {
  cursor: pointer;
}

/* ---- 预览对话框 ---- */
.preview-body {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-image {
  max-width: 100%;
  max-height: 60vh;
  border-radius: 8px;
  object-fit: contain;
}
.preview-media {
  width: 100%;
  max-height: 60vh;
  border-radius: 8px;
  background: #000;
}
.preview-audio {
  width: 100%;
}
.preview-iframe {
  width: 100%;
  height: 60vh;
  border: none;
  border-radius: 8px;
  background: #f9fafb;
}
.preview-text {
  width: 100%;
  max-height: 60vh;
  overflow: auto;
  margin: 0;
  padding: 14px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 13px;
  line-height: 1.6;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Cascadia Code', Consolas, 'Courier New', monospace;
}
.preview-placeholder {
  color: #9ca3af;
  font-size: 13px;
  padding: 40px 0;
}
.preview-unsupported {
  text-align: center;
  padding: 20px 0;
}
.preview-unsupported__icon {
  font-size: 46px;
  display: block;
  margin-bottom: 10px;
}
.preview-unsupported__title {
  font-size: 15px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 4px;
}
.preview-unsupported__meta {
  font-size: 13px;
  color: #9ca3af;
  margin: 0 0 16px;
}
.preview-unsupported__actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.card-title {
  font-weight: 600;
  font-size: 15px;
  color: #1f2937;
}

.file-name {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #1f2937;
}
.file-icon {
  color: #6b7280;
  flex-shrink: 0;
}
.uploader {
  font-size: 13px;
  color: #6b7280;
}

:deep(.el-upload-dragger) {
  border-radius: 12px;
  border: 1.5px dashed rgba(31, 41, 55, 0.18);
  background: rgba(31, 41, 55, 0.02);
  transition: all 0.2s;
}
:deep(.el-upload-dragger:hover) {
  border-color: rgba(99, 102, 241, 0.5);
  background: rgba(99, 102, 241, 0.04);
}
</style>