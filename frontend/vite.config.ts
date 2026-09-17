import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 15173,
    proxy: {
      '/api': {
        target: 'http://localhost:13000',
        changeOrigin: true,
      },
      '/sse': {
        target: 'http://localhost:13000',
        changeOrigin: true,
      },
      // NestJS 业务后端（登录注册 / 对话记录 / 网盘 / 邮件）
      '/auth': {
        target: 'http://localhost:13000',
        changeOrigin: true,
      },
      '/mail': {
        target: 'http://localhost:13000',
        changeOrigin: true,
      },
      '/chat': {
        target: 'http://localhost:13000',
        changeOrigin: true,
        // 关键修复：自行处理响应（含流式/非流式两个分支），
        // 禁用 http-proxy 的默认 pipe，否则默认 pipe + 下方手动 pipe
        // 会把每个响应/每个 SSE 分片写入浏览器两次（表现为 AI 回复内容重复两遍）
        selfHandleResponse: true,
        // SSE 流式对话：禁止代理缓冲，逐块转发给浏览器
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            if (req.url?.includes('/stream')) {
              // 去掉 Accept-Encoding 避免后端返回压缩流（压缩会缓冲）
              _proxyReq.removeHeader('accept-encoding')
            }
          })
          proxy.on('proxyRes', (proxyRes, req, res) => {
            if (!req.url?.includes('/stream')) {
              // 非流式请求：正常代理
              res.writeHead(proxyRes.statusCode!, proxyRes.headers)
              proxyRes.pipe(res)
              return
            }
            // SSE 流式请求：逐块转发，不缓冲（selfHandleResponse 已在代理选项中开启）
            res.writeHead(proxyRes.statusCode!, {
              ...proxyRes.headers,
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'X-Accel-Buffering': 'no',
            })
            proxyRes.pipe(res)
            proxyRes.on('error', () => res.end())
          })
        },
      },
      '/r2': {
        target: 'http://localhost:13000',
        changeOrigin: true,
      },
      // Python AI Agent 后端（FastAPI），端口与 backend/python/.env 的 PORT 保持一致
      '/agent': {
        target: 'http://localhost:18000',
        changeOrigin: true,
      },
    },
  },
})
