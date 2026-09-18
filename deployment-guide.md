# AI 智能体创作系统 — 部署指南
启动项目（共 4 个终端，顺序：Python Agent → 邮件 Worker → NestJS → 前端）：

# 运行时版本：Node 20 LTS（前端 / NestJS / Mail Worker） · Python 3.13（AI Agent）

# 终端 1：Python AI Agent（:18000，语言：Python 3.13，框架：FastAPI 0.115+ / uvicorn 0.30+）
cd backend/python
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 18000 --reload

# 终端 2：邮件 Worker（无端口，语言：TypeScript 6.0 / Node 20 LTS，框架：NestJS 12.0 + Bull 4.16）
cd backend/mail-service
npm install       # 首次
npm run start:dev

# 终端 3：NestJS 业务后端（:13000，语言：TypeScript 6.0 / Node 20 LTS，框架：NestJS 12.0 + TypeORM 0.3.31）
cd backend/nestjs
npm install       # 首次
npm run start:dev

# 终端 4：前端（:15173，语言：TypeScript 6.0 / Node 20 LTS，框架：Vue 3.5 + Vite 8.2）
cd frontend
npm install       # 首次
npm run dev



> 本文档覆盖从零开始搭建整个项目的所有步骤。按顺序执行即可完成部署。

---

## 一、系统概览

### 技术栈与运行时版本

| 服务 | 目录 | 语言 / 运行时 | 主框架 / 关键依赖 |
|---|---|---|---|
| 前端 | `frontend/` | TypeScript 6.0 / Node 20 LTS | Vue 3.5 · Vite 8.2 · Pinia 4.0 · Element Plus 2.14 · Three.js 0.180 |
| 业务后端 | `backend/nestjs/` | TypeScript 6.0 / Node 20 LTS | NestJS 12.0 · TypeORM 0.3.31 · Bull 4.16 · ioredis 5.11 · passport-jwt |
| 邮件 Worker | `backend/mail-service/` | TypeScript 6.0 / Node 20 LTS | NestJS 12.0 · Bull 4.16 · nodemailer 10.0 |
| AI Agent | `backend/python/` | Python 3.13 | FastAPI 0.115+ · uvicorn 0.30+ · LangChain 0.3+ · openai 1.51+ · httpx 0.27+ |
| 数据库 | — | PostgreSQL 16 | — |
| 缓存/队列 | — | Redis 7+ | — |
| 对象存储 | — | Cloudflare R2 (S3 兼容) | — |

> Node 与 Python 版本要求：Node 20 LTS（含 npm，包管理器统一使用 npm）；Python 3.13（不兼容 3.11/3.12，因 requirements.txt 使用 cp313 轮子）。

### 服务端口

| 服务 | 端口 | 说明 |
|---|---|---|
| 前端 Vue 3 (Vite dev) | 5173 | 开发服务器 |
| NestJS API | 3000 | 业务接口 + SSE 推送 |
| Python Agent (FastAPI) | 8000 | AI Agent HTTP 接口 |
| PostgreSQL | 5432 | 数据库 |
| Redis | 6379 | 队列 + 缓存 |

### 通信架构

```
用户浏览器 (Vue3)
    │
    ├── HTTP REST ──→ NestJS (3000) ──→ PostgreSQL (5432)
    │                        │
    │                        ├──→ Redis 队列 (6379) ──→ Python Agent (8000)
    │                        │                              │
    │                        ←── SSE 推送 ←─────────────────┘
    │
    └── SSE ←── NestJS (3000)
```

三种通信路径：
- **HTTP REST**：用户登录、项目 CRUD、文件上传等同步操作
- **Redis 消息队列**：NestJS 把 AI 任务投递到队列，Python 消费执行
- **SSE (Server-Sent Events)**：Python 生成过程中逐段推送结果，经 NestJS 转发给前端实时展示

---

## 二、环境准备

### 2.1 必须安装的软件

#### Node.js 20 LTS

```bash
# 验证安装
node -v   # 应输出 v20.x.x
npm -v    # 应输出 10.x.x
```

下载地址：https://nodejs.org/

> 前端、NestJS、Mail Service 三个服务都要求 Node 20 LTS。包管理器统一使用 npm（项目以 `package-lock.json` 锁定版本），无需额外安装。

#### Python 3.13

```bash
# 验证安装
python --version   # 应输出 Python 3.13.x
pip --version
```

下载地址：https://www.python.org/downloads/

> Python Agent 必须使用 3.13：`requirements.txt` 中 fastapi/uvicorn/langchain 等依赖在 3.13 下会自动选取 cp313 轮子；3.11/3.12 会解析到仅有 cp311/cp312 轮子的旧版本（如 numpy 1.26.4）并触发源码编译失败。

### 2.2 PostgreSQL 16

你已有测试服务器，确认连接信息：
- 主机地址
- 端口（默认 5432）
- 用户名
- 密码
- 数据库名（需要手动创建，见下方步骤）

创建数据库：

```bash
# 连接到你的 PostgreSQL 服务器
psql -h <你的服务器地址> -U <用户名> -p 5432

# 在 psql 交互界面中执行
CREATE DATABASE ai_creator ENCODING 'UTF8';
\q
```

### 2.3 Redis 7+

你已有测试服务器，确认连接信息：
- 主机地址
- 端口（默认 6379）
- 密码（如果有）

验证连接：

```bash
# 连接到你的 Redis 服务器
redis-cli -h <你的服务器地址> -p 6379 -a <密码>
# 输入 PING，应返回 PONG
```

### 2.4 Cloudflare R2

在 Cloudflare 控制台获取以下信息：
- Account ID
- R2 API Token（包含读写权限）
- R2 Access Key ID
- R2 Secret Access Key
- Bucket 名称（需要手动创建一个 bucket）

创建 Bucket：
1. 登录 Cloudflare 控制台 → R2 Object Storage
2. 点击 "Create bucket"
3. 命名为 `ai-creator-works`（或你喜欢的名字）
4. 选择离你最近的区域
5. 创建后记录下 endpoint 地址

### 2.5 大模型 API Key

至少准备一个可用的 LLM API Key：
- OpenAI API Key（推荐）
- 或其他：通义千问 / 文心一言 / DeepSeek 等

---

## 三、项目目录结构

在你本地的开发目录下创建以下结构：

```
ai-creator/
├── frontend/              # Vue 3 前端项目
├── backend/
│   ├── nestjs/            # NestJS 业务服务
│   └── python/            # Python Agent 服务
├── .env                   # 环境变量（所有服务共享）
├── .gitignore
└── README.md
```

创建目录：

```bash
mkdir -p ai-creator/frontend
mkdir -p ai-creator/backend/nestjs
mkdir -p ai-creator/backend/python
cd ai-creator
```

---

## 四、前端 Vue 3 项目搭建

### 4.1 初始化项目

```bash
cd ai-creator/frontend

# 使用 Vite 创建 Vue3 + TypeScript 项目
npm create vite@latest . -- --template vue-ts

# 安装依赖
npm install

# 安装项目需要的依赖
npm install vue-router pinia element-plus axios @element-plus/icons-vue
npm install -D @types/node
```

### 4.2 配置 Vite

创建 `vite.config.ts`：

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
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
    },
  },
})
```

### 4.3 配置 TypeScript

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

创建 `tsconfig.node.json`：

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

### 4.4 创建核心目录结构

```bash
mkdir -p src/{api,components,layouts,router,stores,types,utils,views}
```

### 4.5 验证启动

```bash
npm run dev
```

访问 http://localhost:15173，能看到 Vue 默认页面即成功。

---

## 五、NestJS 业务服务搭建

### 5.1 初始化项目

```bash
cd ai-creator/backend/nestjs

# 使用 NestJS CLI 创建项目
npx @nestjs/cli new . --package-manager npm --skip-git

# 安装依赖
npm install

# 安装项目需要的依赖
npm install @nestjs/typeorm typeorm pg
npm install @nestjs/bull bull @nestjs/microservices
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install @nestjs/config class-validator class-transformer
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
npm install ioredis
npm install -D @types/passport-jwt @types/bull
```

### 5.2 环境变量配置

创建 `.env` 文件（在**项目根目录**——全项目唯一一份，NestJS / Python / mail-service 都从这里读取；以下是 NestJS 需要的变量）：

```env
# ==========================================
# NestJS 环境变量
# ==========================================

# 服务配置
NODE_ENV=development
PORT=13000

# PostgreSQL
DB_HOST=your_pg_host
DB_PORT=5432
DB_USERNAME=your_pg_user
DB_PASSWORD=your_pg_password
DB_DATABASE=ai_creator
DB_SYNC=true
DB_LOGGING=true

# Redis
REDIS_HOST=your_redis_host
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# JWT
JWT_SECRET=your_jwt_secret_change_me
JWT_EXPIRES_IN=7d

# Cloudflare R2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY=your_access_key
R2_SECRET_KEY=your_secret_key
R2_BUCKET=ai-creator-works
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com

# Python Agent
PYTHON_AGENT_URL=http://localhost:18000
```

### 5.3 数据库实体定义

创建 `src/entities/user.entity.ts`：

```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Project } from './project.entity';
import { CreationTask } from './task.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  nickname: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Project, (project) => project.user)
  projects: Project[];

  @OneToMany(() => CreationTask, (task) => task.user)
  tasks: CreationTask[];
}
```

创建 `src/entities/project.entity.ts`：

```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { CreationTask } from './task.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: 'draft' })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @ManyToOne(() => User, (user) => user.projects)
  user: User;

  @OneToMany(() => CreationTask, (task) => task.project)
  tasks: CreationTask[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

创建 `src/entities/task.entity.ts`：

```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne,
} from 'typeorm';
import { User } from './user.entity';
import { Project } from './project.entity';

@Entity('creation_tasks')
export class CreationTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  type: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'jsonb', nullable: true })
  params: Record<string, any>;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, any>;

  @Column({ nullable: true })
  errorMessage: string;

  @ManyToOne(() => User, (user) => user.tasks)
  user: User;

  @ManyToOne(() => Project, (project) => project.tasks)
  project: Project;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 5.4 数据库连接配置

创建 `src/config/database.config.ts`：

```typescript
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const getDatabaseConfig = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get('DB_HOST'),
  port: configService.get<number>('DB_PORT'),
  username: configService.get('DB_USERNAME'),
  password: configService.get('DB_PASSWORD'),
  database: configService.get('DB_DATABASE'),
  entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
  synchronize: configService.get('DB_SYNC') === 'true',
  logging: configService.get('DB_LOGGING') === 'true',
});
```

### 5.5 Redis 和 BullMQ 配置

创建 `src/config/redis.config.ts`：

```typescript
import { ConfigService } from '@nestjs/config';

export const getRedisConfig = (configService: ConfigService) => ({
  host: configService.get('REDIS_HOST'),
  port: configService.get<number>('REDIS_PORT'),
  password: configService.get('REDIS_PASSWORD'),
});

export const getBullConfig = (configService: ConfigService) => ({
  redis: {
    host: configService.get('REDIS_HOST'),
    port: configService.get<number>('REDIS_PORT'),
    password: configService.get('REDIS_PASSWORD'),
  },
});
```

### 5.6 修改 app.module.ts

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { getDatabaseConfig } from './config/database.config';
import { getBullConfig } from './config/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getBullConfig,
    }),
  ],
})
export class AppModule {}
```

### 5.7 验证启动

```bash
# 启动 NestJS（开发模式，自动热重载）
npm run start:dev
```

访问 http://localhost:13000，能看到 "Hello World" 即成功。同时查看终端日志，确认 PostgreSQL 和 Redis 连接成功。

---

## 六、Python Agent 服务搭建

### 6.1 创建虚拟环境

```bash
cd ai-creator/backend/python

# 创建虚拟环境
python3 -m venv .venv

# 激活虚拟环境
source .venv/bin/activate        # Mac/Linux
# .venv\Scripts\activate          # Windows
```

### 6.2 安装依赖

创建 `requirements.txt`：

```txt
fastapi==0.115.0
uvicorn[standard]==0.30.6
redis==5.0.8
rq==1.16.2
langchain==0.3.0
langchain-openai==0.2.0
pydantic==2.9.2
pydantic-settings==2.5.2
httpx==0.27.2
python-dotenv==1.0.1
```

安装：

```bash
pip install -r requirements.txt
```

### 6.3 环境变量配置

Python 需要的变量同样写入项目根目录的 `.env`（端口不写在 .env 里，Python 端口 18000 是 `app/core/config.py` 的默认值）：

```env
# ==========================================
# Python Agent 环境变量
# ==========================================

# 服务配置
PYTHON_ENV=development
HOST=0.0.0.0
PORT=18000

# Redis
REDIS_HOST=your_redis_host
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# PostgreSQL（可选，直接读写数据库用）
DB_HOST=your_pg_host
DB_PORT=5432
DB_USER=your_pg_user
DB_PASSWORD=your_pg_password
DB_NAME=ai_creator

# 大模型 API
OPENAI_API_KEY=sk-your_openai_key
# 其他模型按需添加
# DEEPSEEK_API_KEY=
# QWEN_API_KEY=
```

### 6.4 项目结构

```bash
mkdir -p app/{agents,core,models,schemas,services,utils}
touch app/__init__.py
touch app/agents/__init__.py
touch app/core/__init__.py
touch app/models/__init__.py
touch app/schemas/__init__.py
touch app/services/__init__.py
touch app/utils/__init__.py
```

目录说明：

```
app/
├── agents/         # 各类 Agent 实现
│   ├── orchestrator.py    # 协调器：任务拆解与调度
│   ├── writer.py          # 写作 Agent
│   └── reviewer.py        # 编审 Agent
├── core/           # 核心配置
│   ├── config.py          # 环境变量加载
│   ├── redis_client.py    # Redis 连接
│   └── queue.py           # 队列消费者
├── models/         # 模型适配层
│   ├── gateway.py         # 模型网关：统一调用入口
│   └── providers.py       # 各模型提供商适配
├── schemas/        # 数据模型
│   └── task.py            # 任务数据结构
├── services/       # 业务逻辑
│   └── creation.py        # 创作流程服务
├── utils/          # 工具函数
│   └── logger.py          # 日志
└── main.py         # FastAPI 入口
```

### 6.5 核心代码

创建 `app/core/config.py`：

```python
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PYTHON_ENV: str = "development"
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None

    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USER: str = "postgres"
    DB_PASSWORD: str = ""
    DB_NAME: str = "ai_creator"

    OPENAI_API_KEY: str = ""

    @property
    def redis_url(self) -> str:
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}"

    class Config:
        # 全项目唯一的 .env 在仓库根目录；用 __file__ 定位，与启动时的工作目录无关
        env_file = Path(__file__).resolve().parents[4] / ".env"

settings = Settings()
```

创建 `app/core/redis_client.py`：

```python
import redis
from app.core.config import settings

redis_client = redis.Redis.from_url(
    settings.redis_url,
    decode_responses=True,
)

def get_redis() -> redis.Redis:
    return redis_client
```

创建 `app/core/queue.py`：

```python
from rq import Queue
from app.core.redis_client import get_redis
from app.core.config import settings
import json

# 任务队列名称
QUEUE_NAME = "creation_tasks"

def get_queue() -> Queue:
    return Queue(QUEUE_NAME, connection=get_redis())

def enqueue_task(task_data: dict):
    """将任务投递到队列"""
    q = get_queue()
    job = q.enqueue(
        "app.services.creation.process_task",
        task_data,
        job_timeout=300,
    )
    return job.id
```

创建 `app/main.py`：

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings

app = FastAPI(title="AI Creator Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:15173", "http://localhost:13000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"status": "ok", "service": "ai-creator-agent"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )
```

创建 `app/services/creation.py`：

```python
import json
from app.core.redis_client import get_redis

def process_task(task_data: dict):
    """
    消费队列任务的核心函数。
    被 RQ worker 调用。

    task_data 示例:
    {
        "task_id": "abc123",
        "type": "story",
        "prompt": "写一个科幻故事",
        "params": {"genre": "sci-fi", "length": "medium"}
    }
    """
    task_id = task_data.get("task_id")
    redis_client = get_redis()

    # 标记任务为处理中
    redis_client.set(f"task:{task_id}:status", "processing")

    try:
        # TODO: 调用 Orchestrator 执行实际创作逻辑
        # from app.agents.orchestrator import Orchestrator
        # orchestrator = Orchestrator()
        # result = orchestrator.run(task_data)

        # 模拟流式输出
        result_chunks = ["第一段内容...", "第二段内容...", "第三段内容..."]

        for i, chunk in enumerate(result_chunks):
            # 将每段结果推送到 Redis，NestJS 通过 SSE 读取
            redis_client.publish(
                f"task:{task_id}:stream",
                json.dumps({
                    "task_id": task_id,
                    "chunk": chunk,
                    "progress": int((i + 1) / len(result_chunks) * 100),
                })
            )

        # 标记任务完成
        redis_client.set(f"task:{task_id}:status", "completed")
        redis_client.set(
            f"task:{task_id}:result",
            json.dumps({"content": "".join(result_chunks)})
        )

        return {"status": "completed", "task_id": task_id}

    except Exception as e:
        redis_client.set(f"task:{task_id}:status", "failed")
        redis_client.set(f"task:{task_id}:error", str(e))
        raise e
```

### 6.6 验证启动

```bash
# 启动 FastAPI 服务
uvicorn app.main:app --reload --host 0.0.0.0 --port 18000
```

访问 http://localhost:18000/docs，能看到 Swagger 文档即成功。

### 6.7 启动队列消费者（新开一个终端）

```bash
cd ai-creator/backend/python
source .venv/bin/activate

# 启动 RQ Worker 消费任务队列
rq worker creation_tasks --url "redis://:your_redis_password@your_redis_host:6379"
```

这个终端要保持运行，它会持续监听 Redis 队列。

---

## 七、环境变量汇总

全项目只有一个 `.env`，就在项目根目录（NestJS / Python Agent / mail-service 都直接读取这一份）：

```env
# ==========================================
# 项目环境变量汇总
# 所有服务共用这一份文件（变量清单见 README「第 3 步」模板）
# ==========================================

# PostgreSQL
PG_HOST=your_pg_host
PG_PORT=5432
PG_USER=your_pg_user
PG_PASSWORD=your_pg_password
PG_DB=ai_creator

# Redis
REDIS_HOST=your_redis_host
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# JWT
JWT_SECRET=change_me_in_production_jwt_secret_key_at_least_32_chars

# Cloudflare R2
R2_ACCOUNT_ID=your_cf_account_id
R2_ACCESS_KEY=your_r2_access_key
R2_SECRET_KEY=your_r2_secret_key
R2_BUCKET=ai-creator-works
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com

# OpenAI
OPENAI_API_KEY=sk-your_openai_key

# 服务地址
VITE_API_BASE_URL=http://localhost:13000
PYTHON_AGENT_URL=http://localhost:18000
```

---

## 八、启动顺序

按照以下顺序启动所有服务（需要 4 个终端窗口）：

### 终端 1：前端

```bash
cd ai-creator/frontend
npm run dev
```

### 终端 2：NestJS

```bash
cd ai-creator/backend/nestjs
npm run start:dev
```

### 终端 3：Python Agent

```bash
cd ai-creator/backend/python
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 18000
```

### 终端 4：邮件 Worker（Bull 队列消费者，无 HTTP 端口）

```bash
cd backend/mail-service
npm run start:dev
```

主服务把发信任务投递到 Redis 的 `mail` 队列，该 Worker 消费后通过 163 SMTP 发信；
失败自动重试 3 次（指数退避）。启动顺序建议在 NestJS 之前。

---

## 九、验证清单

全部启动后，逐项验证：

| 序号 | 验证项 | 方法 | 预期结果 |
|---|---|---|---|
| 1 | 前端启动 | 访问 http://localhost:15173 | 显示 Vue 默认页面 |
| 2 | NestJS 启动 | 访问 http://localhost:13000 | 返回 JSON 响应 |
| 3 | Python Agent 启动 | 访问 http://localhost:18000/docs | 显示 Swagger 文档 |
| 4 | PostgreSQL 连接 | 查看 NestJS 终端日志 | 无连接错误 |
| 5 | 数据库表创建 | NestJS 启动后自动建表 | `users`、`projects`、`creation_tasks` 表已创建 |
| 6 | Redis 连接 | 查看 NestJS 终端日志 | 无连接错误 |
| 7 | Redis 队列 | 手动向队列发消息 | Python Worker 终端显示收到任务 |
| 8 | R2 连接 | 在 NestJS 里尝试上传文件 | 上传成功 |

---

## 十、常见问题

### 端口被占用

```bash
# 查看哪个进程占用了端口
lsof -i :13000       # Mac
netstat -ano | findstr :13000   # Windows

# 杀掉进程后重新启动
```

### PostgreSQL 连接失败

- 检查服务器防火墙是否开放 5432 端口
- 检查 `pg_hba.conf` 是否允许你的 IP 连接
- 检查用户名密码是否正确
- 验证命令：`psql -h <host> -U <user> -d ai_creator`

### Redis 连接失败

- 检查服务器防火墙是否开放 6379 端口
- 检查 Redis 配置 `bind` 是否允许远程连接
- 检查密码是否正确
- 验证命令：`redis-cli -h <host> -p 6379 -a <password> ping`

### NestJS 数据库连接报错

- 确认根目录 `.env` 中的 `DB_HOST`、`DB_USERNAME`、`DB_PASSWORD` 正确
- 确认数据库 `ai_creator` 已创建
- 首次启动设置 `DB_SYNC=true` 让 TypeORM 自动建表

### Python 依赖安装失败

```bash
# 升级 pip
pip install --upgrade pip

# 如果 LangChain 安装慢，使用国内镜像
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### npm 安装慢

```bash
# 使用淘宝镜像
npm config set registry https://registry.npmmirror.com
```

### R2 上传失败

- 检查 R2 API Token 权限是否包含读写
- 检查 endpoint 格式是否正确：`https://<account-id>.r2.cloudflarestorage.com`
- 检查 bucket 是否已创建

---

## 十一、.gitignore

在项目根目录创建 `.gitignore`：

```gitignore
# 依赖
node_modules/
.venv/
__pycache__/
*.pyc

# 环境变量
.env
.env.local

# 构建产物
dist/
build/

# IDE
.vscode/
.idea/

# 系统文件
.DS_Store
Thumbs.db

# 日志
*.log
```
