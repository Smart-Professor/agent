# Cloudflare R2 对象存储对接文档

可直接复制到其他项目使用的 R2 全栈对接方案：NestJS 后端 + Vue 3 前端，S3 协议直连。

---

## 一、架构总览

```
┌─────────────────┐       HTTP        ┌──────────────────┐      S3 API      ┌─────────────────┐
│   Vue 3 前端     │  ───────────────► │  NestJS 后端      │  ──────────────► │  Cloudflare R2  │
│  (api/r2.js)    │  ◄─────────────── │  (r2 module)     │  ◄────────────── │  (S3 兼容存储)   │
└─────────────────┘                   └──────────────────┘                   └─────────────────┘
     上传: XHR + FormData                   @aws-sdk/client-s3                  Bucket
     下载: fetch → blob                     ConfigService 读 .env               公开域名 / 代理下载
     删除: DELETE
```

| 端 | 技术栈 | 文件 |
|----|--------|------|
| 后端 | NestJS + @aws-sdk/client-s3 + multer | `r2.module.ts` / `r2.controller.ts` / `r2.service.ts` |
| 前端 | Vue 3 + 原生 XHR/fetch | `api/r2.js` / `views/Storage.vue` |

---

## 二、后端实现（NestJS）

### 2.1 安装依赖

```bash
npm install @aws-sdk/client-s3 @nestjs/config
# multer 用于文件上传解析（NestJS 默认自带 platform-express）
npm install @types/multer
```

### 2.2 环境变量（.env）

```env
# ===== Cloudflare R2 配置 =====
# 在 Cloudflare 控制台 → R2 → 你的桶 → Settings 里找到这些值

# 账户 ID（R2 概览页右上角）
R2_ACCOUNT_ID=你的账户ID

# Access Key（R2 → Manage R2 API Tokens → 创建 API Token 后获得）
R2_ACCESS_KEY_ID=你的AccessKeyID
R2_SECRET_ACCESS_KEY=你的SecretAccessKey

# 桶名
R2_BUCKET_NAME=你的桶名

# S3 兼容端点，格式固定：https://<账户ID>.r2.cloudflarestorage.com
R2_ENDPOINT=https://你的账户ID.r2.cloudflarestorage.com

# 公开访问域名（绑了自定义域名或开了 public 时填，没有就留空）
R2_PUBLIC_URL=https://你的公开域名
```

### 2.3 R2 Service（`r2.service.ts`）

封装 S3 客户端，提供 upload / download / delete 三个方法。

```typescript
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

@Injectable()
export class R2Service {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('R2_BUCKET_NAME')!;
    this.publicUrl = this.config.get<string>('R2_PUBLIC_URL')!;

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: this.config.get<string>('R2_ENDPOINT'),
      credentials: {
        accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY')!,
      },
    });
  }

  // 上传文件，返回访问 URL
  async upload(
    key: string,
    body: Buffer | Readable,
    contentType: string,
  ): Promise<string> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return this.publicUrl
        ? `${this.publicUrl}/${key}`
        : `r2://${this.bucket}/${key}`;
    } catch (e) {
      throw new InternalServerErrorException(`R2 上传失败: ${e.message}`);
    }
  }

  // 下载文件，返回 Buffer
  async download(key: string): Promise<Buffer> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as Readable) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    } catch (e) {
      throw new InternalServerErrorException(`R2 下载失败: ${e.message}`);
    }
  }

  // 删除文件
  async delete(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (e) {
      throw new InternalServerErrorException(`R2 删除失败: ${e.message}`);
    }
  }
}
```

### 2.4 R2 Controller（`r2.controller.ts`）

提供三个 REST 接口：

```typescript
import {
  Controller, Post, UseInterceptors, UploadedFile,
  Get, Param, Res, Delete, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as express from 'express';
import { R2Service } from './r2.service';

@Controller('r2')
export class R2Controller {
  constructor(private readonly r2Service: R2Service) {}

  // 上传：POST /r2/upload （form-data，字段名 file）
  // 返回：{ url, key }
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('请选择文件');
    // 按日期分目录，防重名
    const key = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${file.originalname}`;
    const url = await this.r2Service.upload(key, file.buffer, file.mimetype);
    return { url, key };
  }

  // 下载：GET /r2/download/:key（key 里的 / 要 URL 编码）
  // 直接返回文件二进制流
  @Get('download/:key')
  async download(@Param('key') key: string, @Res() res: express.Response) {
    const buffer = await this.r2Service.download(key);
    res.send(buffer);
  }

  // 删除：DELETE /r2/:key
  // 返回：{ message, key }
  @Delete(':key')
  async delete(@Param('key') key: string) {
    await this.r2Service.delete(key);
    return { message: '删除成功', key };
  }
}
```

### 2.5 R2 Module（`r2.module.ts`）

```typescript
import { Module } from '@nestjs/common';
import { R2Service } from './r2.service';
import { R2Controller } from './r2.controller';

@Module({
  providers: [R2Service],
  controllers: [R2Controller],
  exports: [R2Service],  // 导出后其他模块也可注入使用
})
export class R2Module {}
```

### 2.6 注册到 AppModule

```typescript
import { ConfigModule } from '@nestjs/config';
import { R2Module } from './r2/r2.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),  // 读取 .env，全局可用
    R2Module,
    // ... 其他模块
  ],
})
export class AppModule {}
```

### 2.7 后端 API 一览

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| POST | `/r2/upload` | form-data `file` 字段 | `{ url, key }` |
| GET | `/r2/download/:key` | URL 参数 `key`（`/` 需编码） | 文件二进制流 |
| DELETE | `/r2/:key` | URL 参数 `key`（`/` 需编码） | `{ message, key }` |

> **CORS 提示**：前端跨域调用时，NestJS 需开启 `enableCors()`，否则浏览器会拦截。

---

## 三、前端实现（Vue 3）

### 3.1 API 封装（`api/r2.js`）

可直接复制到任意前端项目，只需改 `BASE` 地址。

```javascript
// R2 对象存储接口封装
// 对接后端：POST /r2/upload、GET /r2/download/:key、DELETE /r2/:key

// 改成你的后端地址
const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:13000'

/**
 * 拼接可访问链接
 * 优先用后端返回的公开 URL（http 开头），
 * 否则退回后端代理下载
 */
export function resolveUrl(key, url = '') {
  if (url && /^https?:\/\//.test(url)) return url
  return `${BASE}/r2/download/${encodeURIComponent(key)}`
}

/**
 * 后端代理下载地址
 * R2 公开域名不带 CORS 头，fetch 会被浏览器拦截，
 * blob 下载必须走 fetch，所以统一走后端代理
 */
export function downloadUrl(key) {
  return `${BASE}/r2/download/${encodeURIComponent(key)}`
}

/**
 * 上传文件（用 XHR 以支持进度回调，fetch 拿不到上传进度）
 * @param {File} file
 * @param {(percent: number) => void} onProgress
 * @returns {Promise<{url: string, key: string}>}
 */
export function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/r2/upload`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* 忽略非 JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data) // { url, key }
      } else {
        reject(new Error(data.message || `上传失败（${xhr.status}）`))
      }
    }
    xhr.onerror = () => reject(new Error('网络错误：后端未启动或被浏览器拦截'))
    xhr.send(fd)
  })
}

/**
 * 删除文件
 * @param {string} key
 * @returns {Promise<{message: string, key: string}>}
 */
export async function removeFile(key) {
  const res = await fetch(`${BASE}/r2/${encodeURIComponent(key)}`, { method: 'DELETE' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `删除失败（${res.status}）`)
  return data
}
```

### 3.2 前端调用示例

```javascript
import { uploadFile, removeFile, resolveUrl, downloadUrl } from '@/api/r2.js'

// ── 上传（带进度） ──
const { url, key } = await uploadFile(file, (percent) => {
  console.log(`上传进度: ${percent}%`)
})

// ── 获取访问链接 ──
const link = resolveUrl(key, url)  // 有公开 URL 用公开，否则走后端代理

// ── 下载（fetch blob 方式，绕过 CORS） ──
const res = await fetch(downloadUrl(key))
const blob = await res.blob()
const blobUrl = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = blobUrl
a.download = filename
a.click()
URL.revokeObjectURL(blobUrl)

// ── 删除 ──
await removeFile(key)
```

### 3.3 上传记录本地持久化

上传成功后，将 `{ key, url, name, size, type, time }` 存入 `localStorage`，页面刷新后仍可展示文件列表。核心逻辑：

```javascript
const STORE_KEY = 'r2-uploads'
const items = ref([])

// 读取
onMounted(() => {
  items.value = JSON.parse(localStorage.getItem(STORE_KEY) || '[]')
})

// 写入
function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(items.value))
}

// 上传成功后追加
items.value.unshift({ key, url, name: file.name, size: file.size, type: file.type, time: new Date().toISOString() })
persist()
```

---

## 四、配置项速查

| 变量 | 在哪获取 | 必填 |
|------|----------|:----:|
| `R2_ACCOUNT_ID` | Cloudflare 控制台 → R2 概览页右上角 | ✅ |
| `R2_ACCESS_KEY_ID` | R2 → Manage R2 API Tokens → 创建 Token | ✅ |
| `R2_SECRET_ACCESS_KEY` | 同上，创建 Token 时获得 | ✅ |
| `R2_BUCKET_NAME` | R2 → 你的桶名 | ✅ |
| `R2_ENDPOINT` | 固定格式 `https://<账户ID>.r2.cloudflarestorage.com` | ✅ |
| `R2_PUBLIC_URL` | 绑定自定义域名后填写，如 `https://cdn.example.com` | ❌ |

> 如果没有 `R2_PUBLIC_URL`，上传返回 `r2://桶名/key`（浏览器不可直接访问），前端会自动退回后端代理下载。

---

## 五、快速迁移清单

复制到新项目时按此顺序操作：

1. **后端**
   - `npm install @aws-sdk/client-s3 @nestjs/config`
   - 创建 `src/r2/` 目录，放入 `r2.module.ts` / `r2.controller.ts` / `r2.service.ts`
   - 在 `app.module.ts` 中 `imports` 加入 `ConfigModule.forRoot({ isGlobal: true })` 和 `R2Module`
   - 在 `.env` 中填入 R2 配置
   - 确保 `main.ts` 调用了 `app.enableCors()`

2. **前端**
   - 创建 `src/api/r2.js`，修改 `BASE` 为后端地址
   - 在需要上传/下载的页面中 `import { uploadFile, removeFile, resolveUrl, downloadUrl } from '@/api/r2.js'`
   - 如需存储页面，复制 `Storage.vue` 并注册路由

3. **Cloudflare R2 控制台**
   - 创建 Bucket
   - 创建 API Token（勾选 Object Read & Write）
   - （可选）绑定自定义域名用于公开访问
