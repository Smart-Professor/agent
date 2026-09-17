<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * AI 头像：优先显示用户自定义图片（全局默认或会话专属），
 * 无图或图片加载失败时回退内置渐变闪电图标。
 */
const props = defineProps<{
  src?: string | null
}>()

const imgError = ref(false)

// 切换头像 URL 后重置错误态，允许重新加载新图
watch(
  () => props.src,
  () => {
    imgError.value = false
  },
)
</script>

<template>
  <img v-if="src && !imgError" :src="src" alt="AI 头像" @error="imgError = true" />
  <span v-else class="ai-default">
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M13 2L4.5 13.5H11L10 22L19.5 10H13L13 2Z"
        fill="currentColor"
        stroke-linejoin="round"
      />
    </svg>
  </span>
</template>

<style scoped>
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ai-default {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, #0a84ff, #5e6ad2);
}
.ai-default svg {
  width: 58%;
  height: 58%;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.18));
}
</style>
