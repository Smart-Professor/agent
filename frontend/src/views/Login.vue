<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Message, Lock, Key, User } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const mode = ref<'login' | 'register'>('login')
const loading = ref(false)
const sendingCode = ref(false)

const loginForm = reactive({ email: '', password: '' })
const regForm = reactive({ email: '', password: '', confirm: '', code: '', nickname: '' })

// 验证码 60s 重发倒计时
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function startCountdown() {
  countdown.value = 60
  timer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

function afterAuth() {
  const redirect = (route.query.redirect as string) || '/'
  router.replace(redirect)
}

async function handleSendCode() {
  if (sendingCode.value || countdown.value > 0) return
  if (!EMAIL_RE.test(regForm.email)) {
    ElMessage.warning('请先输入正确的邮箱')
    return
  }
  sendingCode.value = true
  try {
    await auth.sendCode(regForm.email)
    ElMessage.success('验证码已发送，5 分钟内有效')
    startCountdown()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发送失败')
  } finally {
    sendingCode.value = false
  }
}

async function handleLogin() {
  if (!EMAIL_RE.test(loginForm.email)) {
    ElMessage.warning('请输入正确的邮箱')
    return
  }
  if (!loginForm.password) {
    ElMessage.warning('请输入密码')
    return
  }
  loading.value = true
  try {
    await auth.login(loginForm.email, loginForm.password)
    ElMessage.success('登录成功')
    afterAuth()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}

async function handleRegister() {
  if (!EMAIL_RE.test(regForm.email)) {
    ElMessage.warning('请输入正确的邮箱')
    return
  }
  if (regForm.password.length < 6 || regForm.password.length > 64) {
    ElMessage.warning('密码长度需在 6-64 位之间')
    return
  }
  if (regForm.password !== regForm.confirm) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  if (!/^\d{6}$/.test(regForm.code)) {
    ElMessage.warning('请输入 6 位数字验证码')
    return
  }
  loading.value = true
  try {
    await auth.register({
      email: regForm.email,
      password: regForm.password,
      code: regForm.code,
      nickname: regForm.nickname.trim() || undefined,
    })
    ElMessage.success('注册成功，欢迎使用')
    afterAuth()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '注册失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <!-- 背景装饰 -->
    <div class="bg-decoration" aria-hidden="true">
      <div class="blob blob--1"></div>
      <div class="blob blob--2"></div>
      <div class="blob blob--3"></div>
      <div class="bg-grid"></div>
    </div>

    <div class="auth-shell">
      <!-- 左侧品牌区 -->
      <div class="auth-brand">
        <div class="brand-head">
          <div class="brand-logo">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="brand-name">Hello AI</span>
        </div>
        <h1 class="brand-title">AI 创作，从这里开始</h1>
        <p class="brand-sub">登录后即可使用智能对话、对话记录云同步与团队共享网盘</p>
        <ul class="brand-points">
          <li>
            <span class="point-dot"></span>
            多轮对话自动保存，换设备随时继续
          </li>
          <li>
            <span class="point-dot"></span>
            Cloudflare R2 共享网盘，一处管理团队文件
          </li>
          <li>
            <span class="point-dot"></span>
            邮箱验证码注册，账号安全有保障
          </li>
        </ul>
      </div>

      <!-- 右侧表单 -->
      <div class="auth-panel">
        <div class="auth-card">
          <div class="mode-tabs">
            <button
              type="button"
              :class="{ active: mode === 'login' }"
              @click="mode = 'login'"
            >登录</button>
            <button
              type="button"
              :class="{ active: mode === 'register' }"
              @click="mode = 'register'"
            >注册</button>
          </div>

          <!-- 登录表单 -->
          <form v-if="mode === 'login'" class="auth-form" @submit.prevent="handleLogin">
            <label class="field">
              <el-icon class="field-icon"><Message /></el-icon>
              <input
                v-model="loginForm.email"
                type="email"
                placeholder="邮箱地址"
                autocomplete="email"
              />
            </label>
            <label class="field">
              <el-icon class="field-icon"><Lock /></el-icon>
              <input
                v-model="loginForm.password"
                type="password"
                placeholder="密码"
                autocomplete="current-password"
              />
            </label>
            <button class="submit-btn" type="submit" :disabled="loading">
              {{ loading ? '登录中…' : '登 录' }}
            </button>
            <p class="form-tip">
              还没有账号？
              <a @click.prevent="mode = 'register'">立即注册</a>
            </p>
          </form>

          <!-- 注册表单 -->
          <form v-else class="auth-form" @submit.prevent="handleRegister">
            <label class="field">
              <el-icon class="field-icon"><Message /></el-icon>
              <input
                v-model="regForm.email"
                type="email"
                placeholder="邮箱地址（用于接收验证码）"
                autocomplete="email"
              />
            </label>
            <label class="field field--code">
              <el-icon class="field-icon"><Key /></el-icon>
              <input
                v-model="regForm.code"
                type="text"
                maxlength="6"
                placeholder="6 位验证码"
                autocomplete="one-time-code"
              />
              <button
                type="button"
                class="code-btn"
                :disabled="countdown > 0 || sendingCode"
                @click="handleSendCode"
              >
                {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
              </button>
            </label>
            <label class="field">
              <el-icon class="field-icon"><User /></el-icon>
              <input
                v-model="regForm.nickname"
                type="text"
                maxlength="32"
                placeholder="昵称（可选）"
              />
            </label>
            <label class="field">
              <el-icon class="field-icon"><Lock /></el-icon>
              <input
                v-model="regForm.password"
                type="password"
                placeholder="密码（6-64 位）"
                autocomplete="new-password"
              />
            </label>
            <label class="field">
              <el-icon class="field-icon"><Lock /></el-icon>
              <input
                v-model="regForm.confirm"
                type="password"
                placeholder="确认密码"
                autocomplete="new-password"
              />
            </label>
            <button class="submit-btn" type="submit" :disabled="loading">
              {{ loading ? '注册中…' : '注 册' }}
            </button>
            <p class="form-tip">
              验证码 5 分钟内有效 · 已有账号？
              <a @click.prevent="mode = 'login'">去登录</a>
            </p>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  min-height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(135deg, #eef0f7 0%, #e6e8f2 45%, #dde1f0 100%);
}

/* ---- 背景装饰（与主应用一致） ---- */
.bg-decoration {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.75;
  animation: blobFloat 18s ease-in-out infinite alternate;
}
.blob--1 {
  width: 520px;
  height: 520px;
  top: -180px;
  right: -100px;
  background: radial-gradient(circle, #a5b4fc, transparent 70%);
}
.blob--2 {
  width: 460px;
  height: 460px;
  bottom: -160px;
  left: 8%;
  background: radial-gradient(circle, #f9a8d4, transparent 70%);
  animation-delay: -6s;
  animation-duration: 22s;
}
.blob--3 {
  width: 400px;
  height: 400px;
  top: 32%;
  left: -140px;
  background: radial-gradient(circle, #7dd3fc, transparent 70%);
  animation-delay: -12s;
}
.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(31, 41, 55, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(31, 41, 55, 0.04) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 85% 65% at 50% 40%, #000 40%, transparent 100%);
}
@keyframes blobFloat {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(40px, 30px) scale(1.08); }
}

/* ---- 布局 ---- */
.auth-shell {
  position: relative;
  z-index: 1;
  display: flex;
  width: min(960px, 92vw);
  min-height: 560px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: 28px;
  box-shadow: 0 24px 80px rgba(31, 41, 55, 0.12);
  overflow: hidden;
}

.auth-brand {
  flex: 1.1;
  padding: 48px 44px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(150deg, rgba(99, 102, 241, 0.06), rgba(139, 92, 246, 0.03));
  border-right: 1px solid rgba(31, 41, 55, 0.06);
}
.brand-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 44px;
}
.brand-logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #4f46e5, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.35);
}
.brand-name {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.01em;
}
.brand-title {
  font-size: 30px;
  font-weight: 700;
  margin: 0 0 14px;
  letter-spacing: -0.02em;
  line-height: 1.25;
  background: linear-gradient(120deg, #111827 30%, #4f46e5 70%, #8b5cf6);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.brand-sub {
  margin: 0 0 34px;
  font-size: 14px;
  color: #6b7280;
  line-height: 1.7;
}
.brand-points {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.brand-points li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  color: #4b5563;
}
.point-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  flex-shrink: 0;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12);
}

/* ---- 右侧表单 ---- */
.auth-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 36px;
}
.auth-card {
  width: 100%;
  max-width: 340px;
  animation: fadeIn 0.4s ease;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.mode-tabs {
  display: flex;
  background: rgba(31, 41, 55, 0.06);
  border-radius: 12px;
  padding: 4px;
  margin-bottom: 26px;
}
.mode-tabs button {
  flex: 1;
  border: none;
  background: transparent;
  padding: 9px 0;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.mode-tabs button.active {
  background: #ffffff;
  color: #1f2937;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(31, 41, 55, 0.08);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: 46px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: 12px;
  transition: all 0.2s;
}
.field:focus-within {
  border-color: rgba(99, 102, 241, 0.5);
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
}
.field-icon {
  color: #9ca3af;
  flex-shrink: 0;
  font-size: 16px;
}
.field input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: #1f2937;
  font-family: inherit;
}
.field input::placeholder { color: #9ca3af; }

.field--code .code-btn {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: #4f46e5;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 0 4px 10px;
  border-left: 1px solid rgba(31, 41, 55, 0.1);
  font-family: inherit;
  white-space: nowrap;
}
.field--code .code-btn:disabled {
  color: #9ca3af;
  cursor: not-allowed;
}

.submit-btn {
  margin-top: 6px;
  height: 46px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  letter-spacing: 0.15em;
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.35);
}
.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 9px 24px rgba(99, 102, 241, 0.45);
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.form-tip {
  margin: 4px 0 0;
  text-align: center;
  font-size: 12.5px;
  color: #9ca3af;
}
.form-tip a {
  color: #4f46e5;
  cursor: pointer;
  text-decoration: none;
  font-weight: 500;
}
.form-tip a:hover { text-decoration: underline; }

/* ---- 移动端 ---- */
@media (max-width: 760px) {
  .auth-brand { display: none; }
  .auth-shell { min-height: auto; width: min(420px, 94vw); }
  .auth-panel { padding: 32px 24px; }
}
</style>