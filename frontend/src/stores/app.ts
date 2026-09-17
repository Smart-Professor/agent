import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { listModels } from '@/api/chat'

/** 模型多模态能力声明（来自后端模型注册表；纯文本模型两项均为 false） */
export interface ModelCapabilities {
  vision: boolean
  audio: boolean
}

export interface ModelOption {
  id: string
  label: string
  capabilities: ModelCapabilities
}

/** Python 未启动时的回退清单（与 backend/python/app/models/registry.py 保持一致） */
const FALLBACK_MODELS: ModelOption[] = [
  { id: 'mimo-v2.5', label: 'MiMo v2.5（默认 · 响应快）', capabilities: { vision: true, audio: false } },
  { id: 'mimo-v2.5-pro', label: 'MiMo v2.5 Pro（深度推理 · 较慢）', capabilities: { vision: true, audio: false } },
  { id: 'GLM-5.3-Flash', label: 'GLM-5.3 Flash（便宜快速 · 开发推荐）', capabilities: { vision: true, audio: false } },
]

/**
 * 可选模型清单：默认用回退清单，应用启动后从后端拉取真实清单（含多模态能力）。
 * 前端据此门控多模态附件功能：模型不支持 vision 就不能发图片理解、不支持 audio 就不能发语音。
 */
export const MODEL_OPTIONS = ref<ModelOption[]>([...FALLBACK_MODELS])

export type ModelId = string

const DEFAULT_MODEL: ModelId = 'mimo-v2.5'

export const useAppStore = defineStore('app', () => {
  // 侧边栏折叠状态（持久化到 localStorage）
  const sidebarCollapsed = ref(localStorage.getItem('sidebar-collapsed') === '1')

  /** 全局设置弹窗开关（任意页面均可打开，不切换路由） */
  const settingsVisible = ref(false)

  /** 全局默认模型（localStorage 持久化，个人中心可改） */
  const defaultModel = ref<ModelId | null>(
    (localStorage.getItem('default-model') as ModelId | null) || DEFAULT_MODEL,
  )

  /** 默认模型的展示名（未设置时显示内置默认） */
  const defaultModelLabel = computed(
    () =>
      MODEL_OPTIONS.value.find((m) => m.id === defaultModel.value)?.label ??
      `内置默认（${DEFAULT_MODEL}）`,
  )

  /** 从后端加载模型清单（含能力声明）；失败时保留回退清单。只拉取一次 */
  let modelsLoaded = false
  async function loadModels() {
    if (modelsLoaded) return
    modelsLoaded = true
    try {
      const res = await listModels()
      if (res.models?.length) MODEL_OPTIONS.value = res.models
    } catch {
      /* 后端/Python 不可用：保留回退清单，模型下拉仍可正常使用 */
    }
  }

  /** 查询某个模型的能力声明（未知模型按纯文本处理） */
  function modelCapabilities(id: string | null | undefined): ModelCapabilities {
    return (
      MODEL_OPTIONS.value.find((m) => m.id === id)?.capabilities ?? {
        vision: false,
        audio: false,
      }
    )
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
    localStorage.setItem('sidebar-collapsed', sidebarCollapsed.value ? '1' : '0')
  }

  /** 设置全局默认模型 */
  function setDefaultModel(id: ModelId) {
    defaultModel.value = id
    localStorage.setItem('default-model', id)
  }

  function openSettings() {
    settingsVisible.value = true
  }
  function closeSettings() {
    settingsVisible.value = false
  }

  return {
    sidebarCollapsed,
    toggleSidebar,
    defaultModel,
    defaultModelLabel,
    setDefaultModel,
    settingsVisible,
    openSettings,
    closeSettings,
    MODEL_OPTIONS,
    loadModels,
    modelCapabilities,
  }
})
