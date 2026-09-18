# 设计：全项目收敛为唯一的根 `.env`

日期：2026-09-18
状态：已与需求方确认

## 背景与目标

现状是"一服务一 .env"：`backend/nestjs/.env`、`backend/python/.env`、`backend/mail-service/.env`、`frontend/.env` 四处分散，另有根目录参考文件 `.env`（自述"不被任何程序读取"，其中 Redis 密码已失效）与汇总备份 `.env.all`。

目标：**全项目只有一个 `.env`**，位于仓库根目录。维护者只管这一个文件；`.env.all` 原样保留作备份模板，不做任何修改。

顺带确认过的事实（本次不新增功能）：

- GLM-5.3-flash 链路已完整存在：后端注册表（`backend/python/app/models/registry.py`）、`GMLMODEL_API_KEY`、前端模型下拉（`frontend/src/views/Chat.vue`、`frontend/src/components/SettingsDialog.vue`）均已可用，智谱 key 与模型名已实测通过。
- 前端无任何代码读取 `VITE_API_BASE`（全目录 grep 零命中），`frontend/.env` 可安全删除。

## 设计

### 1. 根 `.env`（覆盖现有旧参考文件）

内容为 `.env.all` 的全部**数据变量**（值以 `.env.all` 为准，本文件不记录真实密钥），按用途分组：

- 服务间地址：`PYTHON_AGENT_URL`、`IMAGE_TOOL_URL`、`INTERNAL_TOKEN`
- PostgreSQL：共享 `DB_HOST` / `DB_PORT` / `DB_PASSWORD` + 双命名对——NestJS 读 `DB_USERNAME` / `DB_DATABASE`，Python 读 `DB_USER` / `DB_NAME`（同名不同义的坑已在 `.env.all` 注明，双命名共存互不冲突）
- Redis（三服务共用）：`REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`
- JWT：`JWT_SECRET` / `JWT_EXPIRES_IN`
- 163 邮箱（NestJS 与 mail-service 共用）：`MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` / `MAIL_USER` / `MAIL_PASS` / `MAIL_FROM_NAME`
- Cloudflare R2：`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_ENDPOINT` / `R2_PUBLIC_URL`
- 生图服务：`IMAGE_GEN_URL` / `IMAGE_MODIFY_URL` / `IMAGE_MODIFY` / `IMAGE_MODIFY_API_KEY`
- MiMo：`MIMO_API_KEY` / `MIMO_BASE_URL` / `MIMO_MODEL`
- GLM：`GMLMODEL_API_KEY` / `GMLMODEL_MODEL`（保留历史拼写，代码侧 `registry.py` 实际只读 `GMLMODEL_API_KEY`）

**不放入** `PORT` / `HOST` / `PYTHON_ENV`：它们是运行参数不是数据，且 `PORT` 在 NestJS(13000) 与 Python(18000) 之间同名冲突——这是单文件方案唯一的坑。处理方式：端口降级为代码常量（见下）。文件头注释写明：全项目唯一 .env、数据来源 `.env.all`、勿添加 `PORT`。

### 2. 代码改动（4 处）

| 文件 | 改动 |
|---|---|
| `backend/python/app/core/config.py` | `env_file = ".env"`（按启动目录解析）→ 用 `Path(__file__).resolve().parents[4] / ".env"` 定位仓库根（与启动目录无关）；`PORT` 默认值 `8000` → `18000` |
| `backend/nestjs/src/app.module.ts` | `ConfigModule.forRoot` 增加 `envFilePath: resolve(process.cwd(), '../../.env')` |
| `backend/nestjs/src/main.ts` | 端口兜底 `process.env.PORT ?? 3000` → 固定 `13000`（注释：Vite 代理与 Python 回调均写死此端口） |
| `backend/mail-service/src/app.module.ts` | 同 NestJS，`envFilePath` 指向根 `.env` |

端口改为代码常量的理由：端口已被 `frontend/vite.config.ts`（硬编码 13000/18000）、`PYTHON_AGENT_URL`、`IMAGE_TOOL_URL` 交叉锁死，本就是约定值。这样即使有人把 `.env.all` 原样复制成根 `.env`（内含两个 `PORT`），NestJS 不受影响，Python 读到的 `PORT=18000`（dotenv 后者覆盖前者）恰好也是正确值。

### 3. 删除 4 个服务 `.env`

`backend/nestjs/.env`、`backend/python/.env`、`backend/mail-service/.env`、`frontend/.env`。逐项核对过，其数据全部包含于 `.env.all`，无丢失；`.env` 均被 `.gitignore` 忽略。

### 4. 明确不动

- `.env.all`（备份，原样保留）
- `backend/agentt-py/`（独立旧服务，自带 `ZHIPUAI_API_KEY` 命名，需求方决定本次不管）
- 前端代码（模型切换功能已存在，零改动）

### 5. 文档同步（env 相关段落，手术式修改）

- `README.md`：第 3 步"配置环境变量（3 个 .env 文件）"改为 1 个根 `.env`；目录树注释、端口说明（L271）、故障排查（L312/L338）中的 `.env` 路径同步
- `PROJECT-OVERVIEW.md`：目录树与"环境变量清单"一节
- `deployment-guide.md`：各服务"创建 .env"章节
- `backend/python/API-FILE-MAP.md`：文件表中 `.env` 条目

统一写明运行约束：**NestJS 与 mail-service 需从各自目录启动**（`npm run start:dev` 等，cwd 即服务目录，据此定位根 `.env`）；Python 端用 `__file__` 定位，从任何目录启动均可。

## 验证

1. Python：从 `backend/python` 启动 → 绑定 18000；`GET /agent/models` 含 `GLM-5.3-Flash`；用 `model=GLM-5.3-Flash` 请求对话端点，流式回复正常
2. NestJS：从 `backend/nestjs` 启动 → 绑定 13000；数据库连接成功（证明根 `.env` 的 DB 值被读到）
3. mail-service：启动 → Redis 连接成功、Bull 正常待消费
4. 端到端：前端 15173 → 下拉选 GLM-5.3-Flash 发消息 → 收到流式回复

## 风险与边界

- cwd 约束：NestJS 系服务按 cwd 定位根 `.env`，非标准启动方式（如从任意目录直接 `node dist/main`）会找不到配置 → 文档注明；如未来需要，可再引入向上查找
- 密钥集中后根 `.env` 成为单点：已被 `.gitignore` 覆盖（`.env` / `.env.all` 均在列），文件头保留警示注释
- `GMLMODEL_MODEL` 为死配置（代码未读），保留以与 `.env.all` 一致，避免无谓 churn

## 范围外

- `agentt-py` 的接入与命名统一
- 前端模型切换功能（已存在，无需新增）
- 端口可配置化（YAGNI：端口是跨服务硬约定）
