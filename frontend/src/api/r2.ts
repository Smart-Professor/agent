/**
 * R2 对象存储接口封装（对接 NestJS 后端，全部接口需登录）
 * POST /r2/upload、POST /r2/avatar、GET /r2/list、GET /r2/download/:key、DELETE /r2/:key
 */
import http from './http'

export interface DriveItem {
  id: string
  key: string
  name: string
  size: number
  type: string
  uploaderId: string
  uploaderName: string
  createdAt: string
  url: string
  /** 是否当前用户上传（只有上传者能删除） */
  mine: boolean
}

/** 网盘文件列表（所有登录用户共享） */
export async function listFiles(): Promise<DriveItem[]> {
  const { data } = await http.get('/r2/list')
  return data as DriveItem[]
}

/** 上传文件到共享网盘（支持进度回调） */
export async function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ id: string; url: string; key: string; name: string; size: number }> {
  const fd = new FormData()
  fd.append('file', file)
  const { data } = await http.post('/r2/upload', fd, {
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    },
  })
  return data
}

/** 上传头像（返回新头像 URL，后端同步更新用户资料） */
export async function uploadAvatar(file: File): Promise<{ url: string; key: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const { data } = await http.post('/r2/avatar', fd)
  return data
}

/** 上传全局默认 AI 头像（后端写入 users.aiAvatar，所有未单独设置的会话生效） */
export async function uploadGlobalAiAvatar(file: File): Promise<{ url: string; key: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const { data } = await http.post('/r2/ai-avatar', fd)
  return data
}

/** 后端代理下载（R2 公开域名不带 CORS 头，blob 下载必须走后端代理） */
export async function downloadBlob(key: string): Promise<Blob> {
  const res = await http.get(`/r2/download/${encodeURIComponent(key)}`, {
    responseType: 'blob',
  })
  return res.data as Blob
}

/** 删除网盘文件（仅上传者可删） */
export async function removeFile(key: string): Promise<void> {
  await http.delete(`/r2/${encodeURIComponent(key)}`)
}