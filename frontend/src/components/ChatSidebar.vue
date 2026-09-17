<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const chat = useChatStore()
const app = useAppStore()
const auth = useAuthStore()
const router = useRouter()

const collapsed = computed(() => app.sidebarCollapsed)

const sortedConversations = computed(() =>
  [...chat.conversations].sort((a, b) => b.updatedAt - a.updatedAt),
)

const displayName = computed(
  () => auth.user?.nickname || auth.user?.email?.split('@')[0] || '用户',
)

onMounted(() => {
  chat.refresh().catch(() => {})
})

/** 切回聊天主界面：从「个人中心 / 共享网盘」等页面点击会话时需要 */
function goChat() {
  if (router.currentRoute.value.name !== 'chat') router.push({ name: 'chat' })
}

function handleNew() {
  chat.newConversation()
  goChat()
}

function handleSelect(id: string) {
  chat.selectConversation(id).catch(() => {})
  // 关键：当前不在聊天路由时（如在个人中心 / 共享网盘）必须切回聊天界面，
  // 否则只是更新了 activeId，右侧 RouterView 仍停留在原页面，看起来"点了没反应"。
  goChat()
  // 移动端选择后自动收起
  if (window.innerWidth <= 720 && !collapsed.value) app.toggleSidebar()
}

async function handleDelete(id: string, e: MouseEvent) {
  e.stopPropagation()
  try {
    await ElMessageBox.confirm('删除该对话及其全部消息？', '删除对话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户取消
  }
  try {
    await chat.deleteConversation(id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

async function handleLogout() {
  auth.logout()
  chat.reset()
  router.replace({ name: 'login' })
}

function toggleSidebar() {
  app.toggleSidebar()
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const pad = (n: number) => String(n).padStart(2, '0')
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <!-- 移动端遮罩 -->
  <div
    class="sidebar-mask"
    :class="{ show: !collapsed }"
    @click="toggleSidebar"
  ></div>

  <aside class="sidebar" :class="{ 'sidebar--collapsed': collapsed }">
    <!-- 顶部：品牌 + 折叠按钮 -->
    <div class="sidebar__top">
      <div class="brand" v-if="!collapsed">
        <div class="brand__logo">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="brand__name">Hello AI</span>
      </div>
      <button class="icon-btn" @click="toggleSidebar" :title="collapsed ? '展开' : '折叠'">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path v-if="collapsed" d="M9 18l6-6-6-6"/>
          <path v-else d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
    </div>

    <!-- 新建对话按钮 -->
    <div class="sidebar__new">
      <button class="new-btn" @click="handleNew" :title="collapsed ? '新建对话' : ''">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span v-if="!collapsed">新建对话</span>
      </button>
    </div>

    <!-- 历史会话列表 -->
    <div class="sidebar__list" v-show="!collapsed">
      <div class="list-label">历史对话</div>
      <div
        v-for="conv in sortedConversations"
        :key="conv.id"
        class="conv-item"
        :class="{ active: conv.id === chat.activeId }"
        @click="handleSelect(conv.id)"
      >
        <svg class="conv-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="conv-title">{{ conv.title }}</span>
        <span class="conv-time">{{ formatTime(conv.updatedAt) }}</span>
        <button class="conv-del" @click="handleDelete(conv.id, $event)" title="删除">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          </svg>
        </button>
      </div>
      <div v-if="!sortedConversations.length" class="empty-hint">
        {{ chat.loadingList ? '加载中…' : '暂无历史对话' }}
      </div>
    </div>

    <!-- 底部：导航 + 用户区 -->
    <div class="sidebar__footer">
      <div class="nav-links" v-show="!collapsed">
        <RouterLink to="/storage" class="nav-item" :class="{ active: $route.name === 'storage' }">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>共享网盘</span>
        </RouterLink>
        <!-- 设置：打开弹窗，不切换页面 -->
        <button class="nav-item nav-btn" @click="app.openSettings()" title="设置">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>设置</span>
        </button>
      </div>

      <div v-if="!collapsed" class="user-block" @click="router.push('/profile')" title="个人中心">
        <div class="user-ava">
          <img v-if="auth.user?.avatar" :src="auth.user.avatar" alt="头像" />
          <span v-else>{{ displayName.charAt(0).toUpperCase() }}</span>
        </div>
        <div class="user-meta">
          <span class="user-name">{{ displayName }}</span>
          <span class="user-email">{{ auth.user?.email }}</span>
        </div>
      </div>

      <button class="logout-btn" @click="handleLogout" :title="collapsed ? '退出登录' : ''">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <path d="M16 17l5-5-5-5M21 12H9"/>
        </svg>
        <span v-if="!collapsed">退出登录</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 264px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-right: 1px solid rgba(17, 24, 39, 0.06);
  transition: width 0.25s ease, transform 0.25s ease;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
  z-index: 20;
}
.sidebar--collapsed {
  width: 64px;
}

.sidebar-mask {
  display: none;
}

.sidebar__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 14px 12px;
  gap: 8px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.brand__logo {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(10, 132, 255, 0.22);
}
.brand__name {
  font-size: 15px;
  font-weight: 700;
  color: #16161a;
  white-space: nowrap;
  letter-spacing: -0.01em;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #6e6e73;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}
.icon-btn:hover {
  background: rgba(17, 24, 39, 0.06);
  color: #1d1d1f;
}

.sidebar__new {
  padding: 4px 12px 14px;
}
.new-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
  color: #fff;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(10, 132, 255, 0.24);
}
.new-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(10, 132, 255, 0.3);
}
.new-btn:active { transform: translateY(0); }
.sidebar--collapsed .new-btn {
  padding: 10px 0;
  box-shadow: none;
  background: transparent;
  color: #6e6e73;
  border: 1px solid rgba(17, 24, 39, 0.12);
}
.sidebar--collapsed .new-btn:hover {
  background: rgba(17, 24, 39, 0.05);
}

.sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 12px;
}
.sidebar__list::-webkit-scrollbar { width: 4px; }
.sidebar__list::-webkit-scrollbar-thumb {
  background: rgba(17, 24, 39, 0.12);
  border-radius: 2px;
}

.list-label {
  font-size: 11px;
  font-weight: 600;
  color: #a1a1a6;
  padding: 8px 10px 6px;
  letter-spacing: 0.06em;
}

.conv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 10px;
  cursor: pointer;
  color: #3a3a40;
  transition: all 0.15s;
  margin-bottom: 2px;
  position: relative;
}
.conv-item:hover {
  background: rgba(17, 24, 39, 0.05);
}
.conv-item.active {
  background: rgba(91, 91, 214, 0.1);
  color: #4340c0;
  font-weight: 500;
}
.conv-icon {
  flex-shrink: 0;
  color: #a1a1a6;
}
.conv-item.active .conv-icon { color: #5b5bd6; }

.conv-title {
  flex: 1;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-time {
  font-size: 11px;
  color: #b0b0b5;
  flex-shrink: 0;
}
.conv-item:hover .conv-time { opacity: 0; }
.conv-del {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #a1a1a6;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
}
.conv-item:hover .conv-del { display: flex; }
.conv-del:hover { background: rgba(214, 69, 69, 0.12); color: #b3261e; }

.empty-hint {
  text-align: center;
  color: #a1a1a6;
  font-size: 13px;
  padding: 24px 0;
}

/* ---- 底部导航 + 用户区 ---- */
.sidebar__footer {
  border-top: 1px solid rgba(17, 24, 39, 0.07);
  padding: 10px 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.nav-links {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 10px;
  color: #3a3a40;
  font-size: 13.5px;
  text-decoration: none;
  transition: all 0.15s;
}

/* 设置按钮（button 版 nav-item）：重置原生样式与链接一致 */
.nav-btn {
  width: 100%;
  border: none;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.nav-btn:hover {
  background: rgba(17, 24, 39, 0.05);
}
.nav-item:hover {
  background: rgba(17, 24, 39, 0.05);
  color: #1d1d1f;
}
.nav-item.active {
  background: rgba(91, 91, 214, 0.1);
  color: #4340c0;
  font-weight: 500;
}

.user-block {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
}
.user-block:hover {
  background: rgba(17, 24, 39, 0.04);
  border-color: rgba(17, 24, 39, 0.08);
}
.user-ava {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 3px 8px rgba(10, 132, 255, 0.22);
}
.user-ava img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.user-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}
.user-name {
  font-size: 13px;
  font-weight: 600;
  color: #1d1d1f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-email {
  font-size: 11px;
  color: #a1a1a6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #86868b;
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.logout-btn:hover {
  background: rgba(214, 69, 69, 0.08);
  color: #b3261e;
}
.sidebar--collapsed .sidebar__footer {
  padding: 10px 12px 14px;
  align-items: center;
}
.sidebar--collapsed .logout-btn {
  padding: 10px 0;
  width: 100%;
}

/* ---- 移动端：侧边栏变为抽屉 ---- */
@media (max-width: 720px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    width: 272px;
    transform: translateX(0);
    box-shadow: 8px 0 32px rgba(17, 24, 39, 0.12);
  }
  .sidebar--collapsed {
    width: 272px;
    transform: translateX(-100%);
  }
  .sidebar--collapsed .new-btn {
    padding: 10px 12px;
    background: linear-gradient(135deg, #0a84ff, #5e6ad2);
    color: #fff;
    border: none;
    box-shadow: 0 4px 12px rgba(10, 132, 255, 0.24);
  }
  .sidebar-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(17, 24, 39, 0.3);
    backdrop-filter: blur(2px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s;
    z-index: 15;
  }
  .sidebar-mask.show {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>