<script setup lang="ts">
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
</script>

<template>
  <div class="home">
    <el-card shadow="never">
      <template #header>
        <span style="font-weight: 600">系统概览</span>
      </template>
      <p>AI 智能体创作系统已就绪，包含三个服务：</p>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="前端 (Vue 3 + Vite)">
          http://localhost:15173
        </el-descriptions-item>
        <el-descriptions-item label="业务后端 (NestJS)">
          http://localhost:13000
        </el-descriptions-item>
        <el-descriptions-item label="AI Agent (FastAPI)">
          http://localhost:18000/docs
        </el-descriptions-item>
      </el-descriptions>
      <p style="margin-top: 16px">
        前往
        <el-link type="primary" @click="$router.push('/storage')">作品存储 (R2)</el-link>
        页面可测试文件上传、下载与删除。
      </p>
      <p class="tip">
        提示：侧边栏折叠状态等偏好会持久化保存（当前：{{ appStore.sidebarCollapsed ? '折叠' : '展开' }}）。
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.home {
  max-width: 860px;
  margin: 0 auto;
}

.tip {
  margin-top: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
