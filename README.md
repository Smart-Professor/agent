# AI 智能体创作系统

一个基于大模型 Agent 的内容创作平台：用户在网页上与 AI 对话创作，后端把消息经 NestJS 转发给 Python AI Agent，生成过程通过 SSE 实时流式推送到前端；支持多模态输入（图片 / 文档 / 音频）、AI 自动生成立绘与配图、作品文件统一存入 Cloudflare R2 对象存储、邮箱验证码注册登录。

## 功能特性

- 💬 **流式 AI 对话** —— SSE 逐字输出，展示模型思考过程，支持多轮上下文记忆
- 🖼️ **多模态理解** —— 对话中可发送图片 / 文档 / 音频，由多模态模型直接理解
- 🎨 **AI 生图 / 改图** —— 模型自主调用文生图工具，角色设计模式自动生成角色立绘，图片落 R2
- 👤 **角色设计 Agent** —— 固定人设提示词 + 结构化视觉方案输出
- 📁 **网盘文件管理** —— 拖拽上传、进度条、下载 / 删除（Cloudflare R2，S3 协议）
- 📧 **邮箱验证码注册** —— Bull 消息队列 + 独立邮件 Worker 发信，失败自动重试
- 🔐 **JWT 登录认证** —— Passport/JWT，前端 401 自动跳转登录页

## 架构总览

```
用户浏览器 (Vue 3, :15173)
    │
    ├── HTTP / SSE ──→ NestJS 业务后端 (:13000) ──→ PostgreSQL (:5432)
    │                        │
    │                        ├──→ HTTP/SSE ──→ Python AI Agent (:18000) ──→ 小米 MiMo 大模型
    │                        │                                       │
    │                        │←────── 生图工具回调（内部接口）──────────┘
    │                        ├──→ Bull 队列 (Redis :6379) ──→ 邮件 Worker ──→ SMTP 发信
    │                        └──→ Cloudflare R2 (S3 兼容，文件存储)
    │
    └── 全部请求经 Vite 代理转发，前端无跨域问题
```

| 服务 | 目录 | 端口 | 说明 |
|---|---|---|---|
| 前端 | `frontend/` | **15173** | Vue 3 + Vite 开发服务器，所有 API 经代理转发 |
| 业务后端 | `backend/nestjs/` | **13000** | 认证、会话、邮件队列、R2 文件、生图回调 |
| AI Agent | `backend/python/` | **18000** | FastAPI，调用小米 MiMo（OpenAI 兼容协议） |
| 邮件 Worker | `backend/mail-service/` | 无 | 纯队列消费者，发 SMTP 邮件 |
| PostgreSQL | — | 5432 | 用户 / 会话 / 消息 / 文件等业务数据 |
| Redis | — | 6379 | Bull 邮件队列、验证码与频控、任务队列 |

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Vue 3.5 · TypeScript · Vite 8 · Pinia · Vue Router · Element Plus · Axios · Three.js |
| 业务后端 | NestJS 12 · TypeORM · Bull · Passport/JWT · @aws-sdk/client-s3 · nodemailer |
| AI 服务 | Python 3.13 · FastAPI · LangChain · OpenAI SDK（小米 MiMo 兼容接口） |
| 数据库 | PostgreSQL 16 |
| 缓存/队列 | Redis 7+ |
| 对象存储 | Cloudflare R2（S3 协议） |

## 目录结构

```
agent/
├── .env                       # ⚠️ 全项目唯一环境变量文件（含真实密钥，需自行创建，模板见下文）
├── .env.all                   # 备份模板（数据来源，不提交 git）
├── frontend/                  # Vue 3 前端
│   └── src/
│       ├── api/               # 接口封装（http / chat / r2 / agent）
│       ├── views/             # 页面：Chat / Home / Login / Profile / Storage ...
│       ├── components/        # 聊天消息、侧边栏、设置弹窗、3D 展示等组件
│       ├── stores/            # Pinia 状态（auth / chat / app）
│       └── router/            # 路由
│
├── backend/
│   ├── nestjs/                # 业务后端
│   │   └── src/
│   │       ├── auth/          # 注册 / 登录 / JWT 策略
│   │       ├── chat/          # 会话、消息、SSE 转发、生图回调接口
│   │       ├── mail/          # 邮件队列生产者（验证码 / 通用发信）
│   │       ├── r2/            # R2 上传 / 下载 / 删除 / 列表
│   │       ├── users/ entities/ redis/ config/
│   │           └── ...        # 实体：users / projects / creation_tasks / chats / drive_files
│   │
│   ├── python/                # AI Agent 服务
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── main.py        # FastAPI 入口：/agent/generate、/agent/stream、/health
│   │       ├── agents/        # writer / character_designer
│   │       ├── models/        # 模型网关 + 提供商适配（多模态、生图工具）
│   │       └── core/ services/ schemas/   # 配置、Redis、RQ 队列骨架
│   │
│   ├── mail-service/          # 邮件 Worker（Bull 消费者，无 HTTP 端口）
│   │   └── src/processors/    # 消费 mail 队列 → nodemailer SMTP 发信
│   │
│   └── agentt-py/             # 独立实验模块：LangGraph 多 Agent 主管模式（详见其内 README）
│
├── PROJECT-OVERVIEW.md        # 项目概览
├── deployment-guide.md        # 完整部署指南（含故障排查）
└── R2-INTEGRATION.md          # R2 存储对接方案（可迁移复用）
```

---

## 环境要求

| 软件 | 版本 | 说明 |
|---|---|---|
| Node.js | **20 LTS** | 前端、NestJS、邮件 Worker 三个服务共用，包管理器用 npm |
| Python | **3.13** | ⚠️ 必须是 3.13：依赖按 cp313 轮子锁定，3.11/3.12 会编译失败 |
| PostgreSQL | 16 | 本地安装或远程服务器均可 |
| Redis | 7+ | 同上 |
| Git | 任意 | — |

> Windows / macOS / Linux 均可运行。国内网络建议先配镜像：
> `npm config set registry https://registry.npmmirror.com`
> `pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple`

---

## 快速开始

### 第 1 步：克隆项目

```bash
git clone https://github.com/Smart-Professor/agent.git
cd agent
```

### 第 2 步：准备 PostgreSQL 和 Redis

1. 确保一个可连接的 PostgreSQL 16 实例（本地安装或远程服务器），并创建数据库：

```bash
psql -h <主机> -U <用户名> -p 5432
# psql 交互界面中执行：
CREATE DATABASE ai_creator ENCODING 'UTF8';
\q
```

2. 确保一个可连接的 Redis 7+ 实例，记下地址 / 端口 / 密码（如有）。

> 数据表**无需手动创建**：NestJS 首次启动时 `DB_SYNC=true` 会自动建表。

### 第 3 步：配置环境变量（仅 1 个文件）

项目不提交 .env。在**仓库根目录**创建唯一的 `.env`（模板如下）——所有服务（NestJS / Python Agent / mail-service）都从这一个文件读取，改配置只需改这一处：

```env
# ---------- 服务间地址 ----------
PYTHON_AGENT_URL=http://localhost:18000   # NestJS → Python Agent（保持默认）
IMAGE_TOOL_URL=http://localhost:13000/chat/internal/image   # Python → NestJS 生图回调（保持默认）
INTERNAL_TOKEN=dev-internal-token         # 服务间共享密钥（两边读同一份，天然一致）

# ---------- PostgreSQL ----------
# ⚠️ 命名差异（值填成一样即可）：NestJS 读 DB_USERNAME/DB_DATABASE，Python 读 DB_USER/DB_NAME
DB_HOST=127.0.0.1
DB_PORT=5432
DB_PASSWORD=你的数据库密码
DB_USERNAME=postgres
DB_DATABASE=ai_creator
DB_USER=postgres
DB_NAME=ai_creator

# ---------- Redis（NestJS / Python / mail-service 三方共用） ----------
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# ---------- JWT（NestJS；换成任意 32 位以上随机字符串） ----------
JWT_SECRET=change_me_to_a_random_secret_key_at_least_32_chars
JWT_EXPIRES_IN=7d

# ---------- 163 邮箱（NestJS 与 mail-service 共用；用其他服务商改 host 即可） ----------
MAIL_HOST=smtp.163.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USER=你的完整邮箱@163.com
MAIL_PASS=SMTP授权码
MAIL_FROM_NAME=Agent

# ---------- Cloudflare R2（NestJS；暂时不用可留空，服务仍能启动） ----------
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=ai-creator-works
R2_ENDPOINT=https://你的账户ID.r2.cloudflarestorage.com
R2_PUBLIC_URL=

# ---------- AI 生图 / 改图服务（NestJS，OpenAI Images 兼容接口；不用生图可不填） ----------
IMAGE_GEN_URL=
IMAGE_MODIFY_URL=
IMAGE_MODIFY=gpt-image-2.5
IMAGE_MODIFY_API_KEY=

# ---------- 小米 MiMo 大模型（Python，主对话模型，OpenAI 兼容协议） ----------
# API Key 在 https://platform.xiaomimimo.com 注册获取
MIMO_API_KEY=sk-你的key
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5

# ---------- 智谱 GLM（Python，备用模型，前端下拉可选） ----------
# API Key 在 https://open.bigmodel.cn 获取
GMLMODEL_API_KEY=
GMLMODEL_MODEL=GLM-5.3-flash
```

> ⚠️ **不要把 `PORT` / `HOST` / `PYTHON_ENV` 写进 .env**：端口是跨服务硬约定（NestJS 13000 写死在 `backend/nestjs/src/main.ts`，Python 18000 是 `backend/python/app/core/config.py` 的默认值），`frontend/vite.config.ts` 的代理与上面的回调地址也都写死了端口。写进 .env 会让 NestJS 和 Python 抢同一个同名变量。
>
> **读取方式**：NestJS 与 mail-service 从各自目录启动（npm 脚本），按「cwd 上两级」找到根 .env；Python 按代码位置定位，从任何目录启动均可。
>
> **163 授权码获取**：网易邮箱网页版 → 设置 → POP3/SMTP/IMAP → 开启服务并生成授权码（不是邮箱登录密码）。
>
> **R2 密钥获取**：Cloudflare 控制台 → R2 → Manage R2 API Tokens 创建，endpoint 固定格式 `https://<账户ID>.r2.cloudflarestorage.com`，详见 [R2-INTEGRATION.md](./R2-INTEGRATION.md)。

### 第 4 步：安装依赖并启动（4 个终端）

**终端 1 —— Python AI Agent（:18000）**

```bash
cd backend/python

# 创建并激活虚拟环境
python -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows

pip install -r requirements.txt

uvicorn app.main:app --host 0.0.0.0 --port 18000 --reload
```

**终端 2 —— 邮件 Worker（无端口，先于 NestJS 启动）**

```bash
cd backend/mail-service
npm install
npm run start:dev
```

**终端 3 —— NestJS 业务后端（:13000）**

```bash
cd backend/nestjs
npm install
npm run start:dev
```

**终端 4 —— 前端（:15173）**

```bash
cd frontend
npm install
npm run dev
```

> ⚠️ 端口是约定好的：NestJS 必须 13000（Vite 代理指向它），Python 必须 18000（Vite 与 NestJS 都指向它），前端 15173。改端口需同步修改 `frontend/vite.config.ts`、`backend/nestjs/src/main.ts`（13000 写死处）与 `backend/python/app/core/config.py`（18000 默认值），`.env` 里不放端口。

### 第 5 步：验证

全部启动后逐项检查：

| 检查项 | 方法 | 预期结果 |
|---|---|---|
| 前端 | 浏览器打开 http://localhost:15173 | 显示首页，可跳转登录页 |
| NestJS | 访问 http://localhost:13000 | 返回 Hello World JSON |
| Python Agent | 访问 http://localhost:18000/health | `"model_configured": true`（false 说明 MIMO_API_KEY 没配好） |
| 数据库 | 查看 NestJS 终端日志 | 无连接错误；首次启动自动建表 |
| 邮件 Worker | 查看终端 2 日志 | `SMTP 邮件服务连接正常，开始监听 mail 队列` |
| 端到端 | 在网页注册账号（邮箱验证码）→ 登录 → 发起对话 | 收到验证码邮件；AI 流式回复正常 |

---

## 常见问题

<details>
<summary><b>NestJS 启动后立刻退出 / 数据库连接报错</b></summary>

- 检查 `DB_HOST / DB_USERNAME / DB_PASSWORD / DB_DATABASE` 是否正确（注意 NestJS 用的是 `DB_USERNAME`，不是 `DB_USER`）
- 确认数据库 `ai_creator` 已创建
- PostgreSQL 远程连接需检查防火墙 5432 端口和 `pg_hba.conf`
</details>

<details>
<summary><b>Python 依赖安装失败</b></summary>

确认 Python 版本是 3.13（`python --version`）。3.11/3.12 会解析到没有对应轮子的旧版本并触发源码编译失败。升级 pip 后用清华镜像重装：

```bash
pip install --upgrade pip
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```
</details>

<details>
<summary><b>对话报 503「未配置 MIMO_API_KEY」</b></summary>

根目录 `.env` 中 `MIMO_API_KEY` 没填或没填对。到 https://platform.xiaomimimo.com 注册获取 Key，填好后重启终端 1。
</details>

<details>
<summary><b>注册收不到验证码邮件</b></summary>

- 看终端 2 日志：若提示 SMTP 探测失败，检查 `MAIL_USER`（完整邮箱）和 `MAIL_PASS`（是授权码不是登录密码）
- 确认邮件 Worker 已启动：未启动时 NestJS 会报「邮件服务未响应」
</details>

<details>
<summary><b>端口被占用</b></summary>

```bash
# Windows
netstat -ano | findstr :13000
# macOS / Linux
lsof -i :13000
```

找到进程 PID 后结束它，或按上面的说明同步修改相关端口配置。
</details>

<details>
<summary><b>AI 不生成图片 / 报「未配置图片服务」</b></summary>

生图需要 OpenAI Images 兼容服务：在根目录 `.env` 中填写 `IMAGE_GEN_URL`、`IMAGE_MODIFY_API_KEY`（改图另需 `IMAGE_MODIFY_URL`）。只做文字对话可不配置。
</details>

---

## 可选：启动异步任务队列消费者

`backend/python` 内置了基于 RQ 的异步创作任务链路（预留）。如需体验，在激活虚拟环境后另开一个终端：

```bash
cd backend/python
source .venv/bin/activate
rq worker creation_tasks --url "redis://:<密码>@<主机>:6379"
```

## 附：agentt-py 独立实验模块

`backend/agentt-py` 是一个**独立运行**的 LangGraph 多 Agent 实验服务（Supervisor 主管模式调度 5 个创作 Agent + 文生图，基于智谱 GLM），目前未接入主系统，可单独启动体验：

```bash
cd backend/agentt-py
pip install -r requirements.txt
copy .env.example .env    # 填入 ZHIPUAI_API_KEY（https://open.bigmodel.cn 获取）
python smoke_test.py      # 无 Key 冒烟测试
uvicorn main:app --reload # 启动后浏览器打开 http://localhost:8000
```

详见 [backend/agentt-py/CLAUDE.md](./backend/agentt-py/CLAUDE.md)。

## 相关文档

- [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) —— 项目是什么、由什么组成、当前完成度
- [deployment-guide.md](./deployment-guide.md) —— 完整部署指南与故障排查手册
- [R2-INTEGRATION.md](./R2-INTEGRATION.md) —— R2 对象存储全栈对接方案（可整体迁移到其他项目）

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

你可以自由地使用、学习、修改和分发本项目，包括商业用途；唯一的要求是保留原始的版权声明与许可文本。软件按"现状"提供，不附带任何担保。
