import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http, { TOKEN_KEY, USER_KEY, apiError } from '@/api/http'

/** 安全的用户信息（不含密码） */
export interface SafeUser {
  id: string
  email: string
  nickname?: string | null
  avatar?: string | null
  /** 全局默认 AI 头像；为空时前端使用内置默认头像 */
  aiAvatar?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface RegisterPayload {
  email: string
  password: string
  code: string
  nickname?: string
}

function readUser(): SafeUser | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const user = ref<SafeUser | null>(readUser())

  const isLoggedIn = computed(() => !!token.value)

  /** 登录成功后保存会话 */
  function setSession(t: string, u: SafeUser) {
    token.value = t
    user.value = u
    localStorage.setItem(TOKEN_KEY, t)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
  }

  /** 邮箱 + 密码登录 */
  async function login(email: string, password: string) {
    try {
      const { data } = await http.post('/auth/login', { email, password })
      setSession(data.token, data.user)
    } catch (e) {
      throw new Error(apiError(e))
    }
  }

  /** 邮箱注册（先 POST /mail/send-code 获取验证码） */
  async function register(payload: RegisterPayload) {
    try {
      const { data } = await http.post('/auth/register', payload)
      setSession(data.token, data.user)
    } catch (e) {
      throw new Error(apiError(e))
    }
  }

  /** 发送注册验证码（60s 频控、5 分钟有效） */
  async function sendCode(email: string) {
    try {
      await http.post('/mail/send-code', { email })
    } catch (e) {
      throw new Error(apiError(e))
    }
  }

  /** 拉取最新用户资料 */
  async function fetchProfile() {
    try {
      const { data } = await http.get('/auth/profile')
      user.value = data
      localStorage.setItem(USER_KEY, JSON.stringify(data))
    } catch (e) {
      throw new Error(apiError(e))
    }
  }

  /** 更新昵称 / 头像 / 全局 AI 头像（aiAvatar 传 null 可清除） */
  async function updateProfile(payload: {
    nickname?: string
    avatar?: string
    aiAvatar?: string | null
  }) {
    try {
      const { data } = await http.patch('/auth/profile', payload)
      user.value = data
      localStorage.setItem(USER_KEY, JSON.stringify(data))
    } catch (e) {
      throw new Error(apiError(e))
    }
  }

  /** 退出登录：清空本地会话 */
  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }

  return {
    token,
    user,
    isLoggedIn,
    login,
    register,
    sendCode,
    fetchProfile,
    updateProfile,
    logout,
  }
})