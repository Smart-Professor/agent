<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

onMounted(() => {
  // 动画播放 2.2s 后跳转：守卫已把原目标页存在 splash-redirect（默认 /）
  const timer = setTimeout(() => {
    // 标记本次会话已看过启动动画，避免每次路由跳转都重播
    sessionStorage.setItem('splash-seen', '1')
    const redirect = sessionStorage.getItem('splash-redirect') || '/'
    sessionStorage.removeItem('splash-redirect')
    router.replace(redirect)
  }, 2200)
  onBeforeUnmount(() => clearTimeout(timer))
})
</script>

<template>
  <div class="splash-root">
    <!-- 中央脉冲球 + 旋转光环 -->
    <div class="stage">
      <div class="orbit-ring orbit-1"></div>
      <div class="orbit-ring orbit-2"></div>
      <div class="orbit-ring orbit-3"></div>
      <div class="pulse-ring">
        <div class="pulse-core"></div>
      </div>
    </div>
    <!-- 品牌 -->
    <div class="brand">
      <span class="brand__logo">🚀</span>
      <h1 class="brand__title">MiMo Assistant</h1>
      <p class="brand__subtitle">让思考更有力量</p>
    </div>
    <!-- 底部进度条 -->
    <div class="progress-bar">
      <div class="progress-fill"></div>
    </div>
  </div>
</template>

<style scoped>
.splash-root {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1200px 800px at 50% 40%, rgba(99, 102, 241, 0.12), transparent 60%),
    radial-gradient(900px 700px at 70% 60%, rgba(124, 58, 237, 0.10), transparent 60%),
    linear-gradient(180deg, #f5f3ff 0%, #ede9fe 100%);
  overflow: hidden;
}

/* 舞台：脉冲球居中，光环围绕 */
.stage {
  position: relative;
  width: 420px;
  height: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pulse-ring {
  position: relative;
  z-index: 2;
  width: 140px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: floatY 3.5s ease-in-out infinite;
}
.pulse-core {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #a78bfa, #7c3aed 60%, #5b21b6);
  box-shadow: 0 0 40px rgba(124, 58, 237, 0.55), inset 0 0 18px rgba(255, 255, 255, 0.35);
  animation: pulseCore 2.2s ease-in-out infinite;
}
.pulse-ring::before,
.pulse-ring::after {
  content: '';
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  border: 2px solid rgba(124, 58, 237, 0.25);
  animation: ripple 2.2s ease-out infinite;
}
.pulse-ring::after {
  animation-delay: 0.6s;
  inset: -38px;
  border-width: 1.5px;
}

/* 旋转光环 */
.orbit-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  border: 1.5px dashed rgba(124, 58, 237, 0.25);
}
.orbit-1 {
  width: 220px;
  height: 220px;
  margin: -110px 0 0 -110px;
  animation: spin 9s linear infinite;
}
.orbit-2 {
  width: 320px;
  height: 320px;
  margin: -160px 0 0 -160px;
  border-style: dotted;
  animation: spin 14s linear infinite reverse;
}
.orbit-3 {
  width: 420px;
  height: 420px;
  margin: -210px 0 0 -210px;
  border-color: rgba(124, 58, 237, 0.15);
  animation: spin 20s linear infinite;
}

/* 品牌区 */
.brand {
  position: relative;
  z-index: 2;
  text-align: center;
  margin-top: 8px;
  animation: fadeUp 1.2s ease-out;
}
.brand__logo {
  font-size: 46px;
  filter: drop-shadow(0 8px 18px rgba(124, 58, 237, 0.25));
}
.brand__title {
  margin: 10px 0 6px;
  font-size: 28px;
  font-weight: 800;
  background: linear-gradient(90deg, #7c3aed, #4f46e5);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: 0.5px;
}
.brand__subtitle {
  margin: 0;
  font-size: 13.5px;
  color: #6b7280;
  letter-spacing: 1.2px;
}

/* 底部进度条 */
.progress-bar {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  width: 260px;
  height: 6px;
  border-radius: 999px;
  background: rgba(124, 58, 237, 0.08);
  overflow: hidden;
}
.progress-fill {
  width: 0%;
  height: 100%;
  background: linear-gradient(90deg, #a78bfa, #7c3aed);
  border-radius: 999px;
  animation: progressFill 2.2s ease-in-out forwards;
}

/* 关键帧 */
@keyframes pulseCore {
  0%, 100% { transform: scale(0.95); opacity: 0.9; }
  50% { transform: scale(1.08); opacity: 1; }
}
@keyframes ripple {
  0% { transform: scale(0.85); opacity: 0.6; }
  100% { transform: scale(1.25); opacity: 0; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes floatY {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes progressFill {
  0% { width: 0%; }
  100% { width: 100%; }
}
</style>
