<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadRequestOptions } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { uploadAvatar } from '@/api/r2'
import { formatTime } from '@/utils/format'
import { Camera } from '@element-plus/icons-vue'

const auth = useAuthStore()
const router = useRouter()

const nickname = ref('')
const savingNick = ref(false)
const uploadingAvatar = ref(false)
const loggedOut = ref(false)

const displayName = computed(() => auth.user?.nickname || auth.user?.email?.split('@')[0] || '用户')
const initial = computed(() => displayName.value.charAt(0).toUpperCase())

onMounted(() => {
  auth.fetchProfile().catch(() => {})
  nickname.value = auth.user?.nickname || ''
})

watch(
  () => auth.user?.nickname,
  (v) => {
    nickname.value = v || ''
  },
)

async function handleSaveNickname() {
  const value = nickname.value.trim()
  if (!value) {
    ElMessage.warning('昵称不能为空')
    return
  }
  if (value.length > 32) {
    ElMessage.warning('昵称最长 32 个字符')
    return
  }
  savingNick.value = true
  try {
    await auth.updateProfile({ nickname: value })
    ElMessage.success('昵称已更新')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingNick.value = false
  }
}

/** 头像上传：后端写入 R2 avatars/ 并同步更新资料 */
async function handleAvatar(option: UploadRequestOptions) {
  uploadingAvatar.value = true
  try {
    await uploadAvatar(option.file as File)
    await auth.fetchProfile()
    ElMessage.success('头像已更新')
    option.onSuccess({})
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '头像上传失败')
    option.onError(e as any)
  } finally {
    uploadingAvatar.value = false
  }
}

async function handleLogout() {
  if (loggedOut.value) return
  loggedOut.value = true
  auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="profile">
    <div class="profile-card">
      <div class="cover"></div>

      <div class="body">
        <!-- 头像（点击上传，保存到 R2） -->
        <el-upload
          class="avatar-upload"
          :show-file-list="false"
          :http-request="handleAvatar"
          accept="image/png,image/jpeg,image/gif,image/webp"
        >
          <div class="avatar-wrap" v-loading="uploadingAvatar">
            <img v-if="auth.user?.avatar" :src="auth.user.avatar" class="avatar-img" alt="头像" />
            <span v-else class="avatar-fallback">{{ initial }}</span>
            <div class="avatar-mask">
              <el-icon><Camera /></el-icon>
              <span>更换头像</span>
            </div>
          </div>
        </el-upload>

        <h2 class="name">{{ displayName }}</h2>
        <p class="email">{{ auth.user?.email }}</p>
        <p class="meta">注册于 {{ auth.user ? formatTime(auth.user.createdAt) : '-' }}</p>

        <div class="row">
          <span class="row-label">昵称</span>
          <div class="row-control">
            <el-input
              v-model="nickname"
              maxlength="32"
              show-word-limit
              placeholder="设置昵称"
              style="width: 240px"
              @keyup.enter="handleSaveNickname"
            />
            <el-button type="primary" :loading="savingNick" @click="handleSaveNickname">
              保存
            </el-button>
          </div>
        </div>

        <el-divider style="margin: 26px 0 18px" />

        <!-- 默认模型 / AI 默认头像已移至「设置」弹窗（侧边栏 → 设置） -->

        <div class="actions">
          <el-button @click="router.push('/')">返回对话</el-button>
          <el-button type="danger" plain @click="handleLogout">退出登录</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile {
  height: 100%;
  overflow-y: auto;
  padding: 32px 24px 48px;
  display: flex;
  justify-content: center;
}

.profile-card {
  width: min(560px, 100%);
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(31, 41, 55, 0.07);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(31, 41, 55, 0.08);
  animation: fadeIn 0.4s ease;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.cover {
  height: 110px;
  background: linear-gradient(120deg, #4f46e5, #8b5cf6, #ec4899);
  opacity: 0.85;
}

.body {
  padding: 0 40px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.avatar-upload { margin-top: -48px; }
:deep(.avatar-upload .el-upload) {
  display: block;
  border-radius: 50%;
}
.avatar-wrap {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  background: #eef0f7;
  border: 4px solid #ffffff;
  box-shadow: 0 8px 24px rgba(31, 41, 55, 0.18);
}
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #667eea, #764ba2);
}
.avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.5);
  color: #fff;
  font-size: 11.5px;
  opacity: 0;
  transition: opacity 0.2s;
}
.avatar-wrap:hover .avatar-mask { opacity: 1; }

.name {
  margin: 16px 0 2px;
  font-size: 21px;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.01em;
}
.email {
  margin: 0;
  font-size: 13.5px;
  color: #6b7280;
}
.meta {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: #9ca3af;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 30px;
  width: 100%;
  justify-content: center;
}
.row-label {
  font-size: 13.5px;
  color: #6b7280;
  flex-shrink: 0;
  width: 40px;
  text-align: right;
}
.row-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 默认 AI 头像设置 */
.ai-avatar-section {
  width: 100%;
  margin-top: 8px;
}
.section-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}
.section-desc {
  margin: 0 0 16px;
  font-size: 12.5px;
  color: #9ca3af;
}
.ai-avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.ai-avatar-upload :deep(.el-upload) {
  display: block;
  border-radius: 50%;
}
.ai-avatar-wrap {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  background: #eef0f7;
  border: 3px solid #ffffff;
  box-shadow: 0 4px 12px rgba(31, 41, 55, 0.12);
}
.ai-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ai-avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6366f1;
  background: linear-gradient(135deg, #eef2ff, #e0e7ff);
}
.ai-avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.5);
  color: #fff;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.2s;
}
.ai-avatar-wrap:hover .ai-avatar-mask { opacity: 1; }
.ai-avatar-actions {
  display: flex;
  align-items: center;
}
.ai-avatar-hint {
  font-size: 12.5px;
  color: #9ca3af;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

@media (max-width: 640px) {
  .body { padding: 0 22px 30px; }
  .row { flex-direction: column; gap: 8px; }
  .row-label { width: auto; }
  .ai-avatar-row { flex-direction: column; align-items: flex-start; }
}
</style>