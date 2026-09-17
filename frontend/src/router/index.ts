import { createRouter, createWebHistory } from 'vue-router'

const TOKEN_KEY = 'auth-token'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/splash',
      name: 'splash',
      component: () => import('@/views/Splash.vue'),
      meta: { public: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'chat',
      component: () => import('@/views/Chat.vue'),
    },
    {
      path: '/storage',
      name: 'storage',
      component: () => import('@/views/Storage.vue'),
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/Profile.vue'),
    },
  ],
})

// 全局前置守卫：除公开页（启动页/登录/注册）外，一律需要登录
router.beforeEach((to) => {
  const authed = !!localStorage.getItem(TOKEN_KEY)

  // 未登录：第一次进入先播启动动画，Splash 播完跳登录页
  if (!authed) {
    if (to.name === 'splash') return true
    if (!sessionStorage.getItem('splash-seen')) {
      sessionStorage.setItem('splash-redirect', to.fullPath || '/')
      return { name: 'splash' }
    }
    if (to.name === 'login') return true
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // 已登录访问登录页 → 回首页
  if (to.name === 'login') return { name: 'chat' }
  return true
})

export default router
