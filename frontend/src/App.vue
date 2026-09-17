<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import ChatSidebar from '@/components/ChatSidebar.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'

const route = useRoute()
// 公开页（登录/注册）独立渲染，不显示侧边栏
const isPublicPage = computed(() => !!route.meta.public)
</script>

<template>
  <RouterView v-if="isPublicPage" />
  <div v-else class="app-layout">
    <!-- 背景装饰：克制的柔光 + 细腻网格 -->
    <div class="bg-decoration" aria-hidden="true">
      <div class="blob blob--1"></div>
      <div class="blob blob--2"></div>
      <div class="blob blob--3"></div>
      <div class="bg-grid"></div>
    </div>

    <ChatSidebar />
    <main class="app-main">
      <RouterView />
    </main>

    <!-- 全局设置弹窗：任意页面可打开，不切换路由 -->
    <SettingsDialog />
  </div>
</template>

<style scoped>
.app-layout {
  position: relative;
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: linear-gradient(135deg, #f7f7fb 0%, #f2f2f7 45%, #eceaf4 100%);
}

.app-main {
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 1;
}

/* ---- 背景装饰 ---- */
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
  filter: blur(78px);
  opacity: 0.55;
  animation: blobFloat 20s ease-in-out infinite alternate;
}
.blob--1 {
  width: 480px;
  height: 480px;
  top: -170px;
  right: -90px;
  background: radial-gradient(circle, #dfe3f7, transparent 70%);
}
.blob--2 {
  width: 440px;
  height: 440px;
  bottom: -150px;
  left: 16%;
  background: radial-gradient(circle, #f0e2ef, transparent 70%);
  animation-delay: -7s;
  animation-duration: 24s;
}
.blob--3 {
  width: 380px;
  height: 380px;
  top: 40%;
  left: -130px;
  background: radial-gradient(circle, #ddeef5, transparent 70%);
  animation-delay: -13s;
}

.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(31, 41, 55, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(31, 41, 55, 0.028) 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 38%, #000 40%, transparent 100%);
}

@keyframes blobFloat {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(34px, 26px) scale(1.06); }
}
</style>