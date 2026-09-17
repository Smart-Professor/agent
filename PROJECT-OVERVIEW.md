# AI 智能体创作系统 · 项目概览

> 本文档帮助你快速了解这个项目"是什么、由哪几部分组成、现在能做什么、还差什么"。
> 详细部署步骤见 [deployment-guide.md](./deployment-guide.md)，R2 存储对接细节见 [R2-INTEGRATION.md](./R2-INTEGRATION.md)。

---

## 一、项目简介

一个基于 **大模型 Agent** 的内容创作平台：用户在网页上提交创作需求，后端把任务投递到队列，Python AI Agent 消费任务并调用大模型生成内容，生成过程通过实时推送展示给用户；作品文件可上传到 Cloudflare R2 对象存储统一管理。

项目采用三服务分离架构，前后端通过 HTTP / SSE 通信，后端与 AI 服务之间通过 Redis 消息队列解耦。

---

## 二、架构总览

```
用户浏览器 (Vue 3, :15173)
    │
    ├── HTTP REST ──→ NestJS (:13000) ──→ PostgreSQL (:5432)
    │                        │
    │                        ├──→ Redis 队列 (:6379) ──→ Python Agent (:18000)
    │                        │                              │
    │                        ←── SSE 实时推送 ←──────────────┘
    │
    └── 文件上传/下载 ──→ NestJS ──→ Cloudflare R2 (S3 兼容)
```

三条核心链路：

| 链路 | 用途 |
|---|---|
| HTTP REST | 登录、项目增删改查、文件上传等同步请求 |
| Redis 消息队列 | NestJS 投递 AI 任务，Python Agent 异步消费执行 |
| SSE 推送 | AI 生成过程中逐段回传内容，前端实时展示 |

---

## 三、技术栈

| 层级 | 技术 | 端口 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus + Axios | 5173 |
| 业务后端 | NestJS + TypeORM + Bull + Passport/JWT | 3000 |
| AI 服务 | Python + FastAPI + LangChain + RQ | 8000 |
| 数据库 | PostgreSQL 16 | 5432 |
| 缓存/队列 | Redis 7+ | 6379 |
| 对象存储 | Cloudflare R2（S3 协议，@aws-sdk/client-s3） | — |

---

## 四、目录结构

```
agent/
├── frontend/                 # 前端（npm）
│   ├── .env                  # VITE_API_BASE → http://localhost:13000
│   └── src/
│       ├── api/r2.js         # R2 上传/下载/删除接口封装
│       ├── views/            # 页面：Home（系统概览）、Storage（R2 文件管理）
│       ├── router/ stores/   # 路由、Pinia 状态
│       ├── types/ utils/     # 类型定义、工具函数
│       └── main.ts           # 入口（挂载 Element Plus、路由、Pinia）
│
├── backend/
│   ├── nestjs/               # 业务后端（npm）
│   │   ├── .env              # PG / Redis / JWT / R2 配置（需填真实值）
│   │   └── src/
│   │       ├── entities/     # 数据表：users / projects / creation_tasks
│   │       ├── config/       # TypeORM、Redis/Bull 连接配置
│   │       └── r2/           # R2 模块：controller（3 个接口）+ service + module
│   │
│   └── python/               # AI Agent（venv + uvicorn）
│       ├── .env              # Redis / 数据库 / OpenAI Key（需填真实值）
│       ├── requirements.txt
│       └── app/
│           ├── main.py       # FastAPI 入口（/、/health，已开启 CORS）
│           ├── core/         # 配置、Redis 连接、RQ 队列
│           ├── services/     # 创作任务消费逻辑（调用 MiMo 流式生成并推 Redis）
│           ├── agents/       # writer（已接 MiMo）/ reviewer / orchestrator（预留）
│           └── models/       # 大模型网关与小米 MiMo 提供商适配
│
├── .env                      # 全项目环境变量参考汇总
├── .gitignore
├── deployment-guide.md       # 完整部署指南
└── R2-INTEGRATION.md         # R2 全栈对接方案
```

---

## 五、数据模型（PostgreSQL 三张核心表）

| 表 | 作用 | 关键字段 |
|---|---|---|
| `users` | 用户 | email（唯一）、password、nickname、avatar |
| `projects` | 创作项目 | title、description、status（draft 等）、metadata |
| `creation_tasks` | AI 创作任务 | type、prompt、params、status（pending/processing/completed/failed）、result、errorMessage |

项目与用户为一对多，任务同时关联用户和项目。NestJS 首次启动时 `DB_SYNC=true` 会自动建表。

---

## 六、已提供的接口

### NestJS（:13000）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/r2/upload` | 上传文件（form-data，字段名 `file`），返回 `{ url, key }` |
| GET | `/r2/download/:key` | 代理下载文件二进制流（规避 R2 无 CORS 头问题） |
| DELETE | `/r2/:key` | 删除文件 |
| GET | `/` | 默认 Hello World |

### Python Agent（:18000）

| 路径 | 说明 |
|---|---|
| `/health` | 健康检查 |
| `/docs` | Swagger 接口文档 |

---

## 七、当前完成状态

> 本仓库按部署指南完成了**三端工程骨架 + R2 对象存储全链路代码**。

**已完成并实测通过：**

- 前端工程：首页、R2 文件管理页（拖拽上传、进度条、下载/删除、上传记录本地持久化）、路由、Pinia、Element Plus 中文化
- NestJS：项目脚手架、数据库实体与连接配置、Redis/Bull 配置、**R2 模块完整可用**、CORS
- Python：FastAPI 服务、配置加载、Redis 连接、RQ 队列投递/消费骨架、模拟流式任务
- 三端均已通过启动/编译验证（前端页面浏览器实测、Python `/health` 实测）

**预留待开发（代码中有明确占位）：**

| 待开发项 | 现状 |
|---|---|
| AI 真实创作 | writer/reviewer/orchestrator、模型网关为 `NotImplementedError` 占位，任务目前返回模拟文本 |
| 队列端到端 | 缺 NestJS 任务投递接口与 SSE 转发接口，FastAPI 缺任务提交接口 |
| 用户认证 | JWT 依赖已装，但无 auth 模块和登录接口 |
| 业务前端页 | 登录、项目管理、创作工作台页面尚未创建 |

---

## 八、快速启动

前置条件：Node.js 20+、Python 3.11+、PostgreSQL、Redis、Cloudflare R2 账号。

```bash
# 1. 前端
cd frontend
npm install
npm run dev                   # http://localhost:15173

# 2. 业务后端（先填好 backend/nestjs/.env）
cd backend/nestjs
npm install
npm run start:dev             # http://localhost:13000

# 3. AI Agent（先填好 backend/python/.env）
cd backend/python
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 18000

# 4. 队列消费者（另开终端）
rq worker creation_tasks --url "redis://:<密码>@<主机>:6379"
```

> 不填数据库配置时 NestJS 会因连不上 PostgreSQL 而退出，属正常现象；仅前端页面和 Python 服务可独立启动。

---

## 九、环境变量（启动前必填）

- [backend/nestjs/.env](./backend/nestjs/.env)：`DB_*`（PostgreSQL）、`REDIS_*`、`JWT_SECRET`、`R2_*`（Account ID / Access Key ID / Secret / Bucket / Endpoint / Public URL）
- [backend/python/.env](./backend/python/.env)：`REDIS_*`、`DB_*`、`MIMO_API_KEY`（小米 MiMo，[platform.xiaomimimo.com](https://platform.xiaomimimo.com/) 获取）、`MIMO_MODEL`
- [frontend/.env](./frontend/.env)：`VITE_API_BASE`（后端地址）
- 根目录 [.env](./.env) 是所有变量的参考汇总，不被程序直接读取

R2 密钥在 Cloudflare 控制台 → R2 → Manage R2 API Tokens 创建；endpoint 固定格式为 `https://<账户ID>.r2.cloudflarestorage.com`。
