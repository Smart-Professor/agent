/**
 * HTTP 请求封装（axios）
 * - 请求拦截器：自动携带 JWT（Authorization: Bearer <token>）
 * - 响应拦截器：401 时清除登录态并跳转登录页
 */
import axios from 'axios'
import router from '@/router'

export const TOKEN_KEY = 'auth-token'
export const USER_KEY = 'auth-user'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

const http = axios.create({ baseURL: '/', timeout: 120000 })

// 请求拦截器：统一注入令牌
http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：401 统一登出并跳转
http.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      const current = router.currentRoute.value
      if (current.name !== 'login') {
        router.push({ name: 'login', query: { redirect: current.fullPath } })
      }
    }
    return Promise.reject(error)
  },
)

/** 把接口异常翻译成可展示的文案（兼容 NestJS 的 message 字符串/数组） */
export function apiError(e: unknown): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string }
  const msg = err?.response?.data?.message
  if (Array.isArray(msg)) return msg[0] || '请求失败'
  return msg || err?.message || '请求失败'
}

export default http