<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadRequestOptions } from 'element-plus'
import { useAppStore, MODEL_OPTIONS, type ModelId } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { uploadGlobalAiAvatar } from '@/api/r2'

const app = useAppStore()
const auth = useAuthStore()

/** 当前选中的分类 */
const activeTab = ref<'general' | 'cache'>('general')

const tabs = [
  { key: 'general', label: '通用', icon: '⚙️' },
  { key: 'cache', label: '存储与缓存', icon: '🗄️' },
] as const

/** 设置默认模型（立即生效并持久化） */
function handleSetModel(id: ModelId) {
  app.setDefaultModel(id)
  ElMessage.success(`默认模型已设为 ${id}`)
}

/** 全局默认 AI 头像上传 */
const uploadingAiAvatar = ref(false)

async function handleAiAvatar(option: UploadRequestOptions) {
  uploadingAiAvatar.value = true
  try {
    await uploadGlobalAiAvatar(option.file as File)
    await auth.fetchProfile()
    ElMessage.success('AI 默认头像已更新')
    option.onSuccess({})
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : 'AI 头像上传失败')
    option.onError(e as any)
  } finally {
    uploadingAiAvatar.value = false
  }
}

/** 移除全局默认 AI 头像 */
async function handleRemoveAiAvatar() {
  try {
    await ElMessageBox.confirm('确定要移除默认 AI 头像吗？未单独设置头像的会话将使用内置默认图标。', '移除 AI 头像', {
      confirmButtonText: '确定移除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await auth.updateProfile({ aiAvatar: null })
    ElMessage.success('AI 头像已移除')
  } catch {
    /* 用户取消 */
  }
}

/** 清空本地缓存（保留默认模型与侧边栏状态） */
function handleClearCache() {
  const keep = ['default-model', 'sidebar-collapsed']
  const removed: string[] = []
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key && !keep.includes(key)) {
      localStorage.removeItem(key)
      removed.push(key)
    }
  }
  ElMessage.success(removed.length ? `已清理 ${removed.length} 项本地缓存` : '本地缓存已干净')
}
</script>

<template>
  <el-dialog
    v-model="app.settingsVisible"
    title="设置"
    width="680px"
    :append-to-body="true"
    class="settings-dialog"
  >
    <div class="settings-layout">
      <!-- 左侧分类 -->
      <aside class="settings-nav">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="nav-item"
          :class="{ active: activeTab === t.key }"
          @click="activeTab = t.key"
        >
          <span class="nav-icon">{{ t.icon }}</span>
          <span>{{ t.label }}</span>
        </button>
      </aside>

      <!-- 右侧设置内容 -->
      <section class="settings-content">
        <!-- 通用 -->
        <template v-if="activeTab === 'general'">
          <h3 class="group-title">通用</h3>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">默认模型</div>
              <div class="setting-desc">新对话未手动选择模型时使用</div>
            </div>
            <el-select
              :model-value="app.defaultModel"
              style="width: 190px"
              @update:model-value="handleSetModel"
            >
              <el-option
                v-for="m in MODEL_OPTIONS"
                :key="m.id"
                :label="m.label"
                :value="m.id"
              />
            </el-select>
          </div>

          <el-divider style="margin: 18px 0" />

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">AI 默认头像</div>
              <div class="setting-desc">所有新对话的 AI 头像，可在每个对话中单独覆盖</div>
            </div>
            <div class="avatar-cell">
              <el-upload
                :show-file-list="false"
                :http-request="handleAiAvatar"
                accept="image/png,image/jpeg,image/gif,image/webp"
              >
                <div class="ai-avatar-wrap" v-loading="uploadingAiAvatar" title="点击更换">
                  <img v-if="auth.user?.aiAvatar" :src="auth.user.aiAvatar" class="ai-avatar-img" alt="AI 头像" />
                  <span v-else class="ai-avatar-fallback">🤖</span>
                  <div class="ai-avatar-mask">更换</div>
                </div>
              </el-upload>
              <el-button
                v-if="auth.user?.aiAvatar"
                link
                type="danger"
                size="small"
                @click="handleRemoveAiAvatar"
              >移除</el-button>
            </div>
          </div>
        </template>

        <!-- 存储与缓存 -->
        <template v-else-if="activeTab === 'cache'">
          <h3 class="group-title">存储与缓存</h3>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">清理本地缓存</div>
              <div class="setting-desc">清除浏览器中暂存的界面数据，不影响账号数据</div>
            </div>
            <el-button @click="handleClearCache">清理</el-button>
          </div>
        </template>
      </section>
    </div>
  </el-dialog>
</template>

<style scoped>
/* ---- 左右布局 ---- */
.settings-layout {
  display: flex;
  min-height: 280px;
  margin: 0 -8px;
}

/* 左侧分类导航 */
.settings-nav {
  flex-shrink: 0;
  width: 150px;
  padding-right: 14px;
  border-right: 1px solid rgba(31, 41, 55, 0.08);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  font-size: 13.5px;
  color: #4b5563;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.nav-item:hover {
  background: rgba(91, 91, 214, 0.06);
  color: #1f2937;
}
.nav-item.active {
  background: rgba(91, 91, 214, 0.1);
  color: #4340c0;
  font-weight: 600;
}
.nav-icon {
  font-size: 15px;
}

/* 右侧内容 */
.settings-content {
  flex: 1;
  min-width: 0;
  padding-left: 20px;
}
.group-title {
  margin: 2px 0 16px;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.setting-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 2px;
}
.setting-desc {
  font-size: 12px;
  color: #9ca3af;
}

/* AI 头像预览/上传 */
.avatar-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-avatar-wrap {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  background: rgba(124, 58, 237, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ai-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ai-avatar-fallback {
  font-size: 26px;
}
.ai-avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #fff;
  background: rgba(31, 41, 55, 0.45);
  opacity: 0;
  transition: opacity 0.18s;
}
.ai-avatar-wrap:hover .ai-avatar-mask {
  opacity: 1;
}
</style>
