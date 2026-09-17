/**
 * AI Agent 接口封装
 * 对接 Python FastAPI 后端：POST /agent/generate、POST /agent/stream
 *
 * 通过 vite 代理转发到 http://localhost:8001
 */

export interface GenerateRequest {
  prompt: string
  model?: string
  max_completion_tokens?: number
}

export interface GenerateResponse {
  model: string
  content: string
}

/** 非流式生成：一次性返回完整内容 */
export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  const res = await fetch('/agent/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))).detail || res.statusText
    throw new Error(detail)
  }
  return res.json()
}

/**
 * 流式生成（SSE）：逐段回调内容
 * @param onChunk 每收到一段正文时回调
 * @param signal  AbortSignal，用于中途取消
 * @returns 完整内容字符串
 */
export async function streamGenerate(
  req: GenerateRequest,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/agent/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))).detail || res.statusText
    throw new Error(detail)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 以 \n\n 分割事件
    const events = buffer.split('\n\n')
    buffer = events.pop() || '' // 最后一段可能不完整，留到下一次

    for (const event of events) {
      if (!event.trim()) continue
      // 每行可能以 "data: " 开头
      const lines = event.split('\n')
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') return full
        try {
          const obj = JSON.parse(data)
          if (obj.error) throw new Error(obj.error)
          if (typeof obj.chunk === 'string') {
            full += obj.chunk
            onChunk(obj.chunk)
          }
        } catch (e) {
          if (e instanceof Error && e.message) throw e
        }
      }
    }
  }
  return full
}
