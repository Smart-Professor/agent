# Python Agent · 四大接口文件调用链全图

> 本文档列出 FastAPI 服务的 4 个 HTTP 接口，每个接口**从请求进入到响应返回经过的每一个文件**（含包初始化文件、配置文件、第三方库与外部服务），不是只列直接相关文件。
>
- 服务启动入口：`uvicorn app.main:app --port 18000`
- 所有项目代码位于 `backend/python/app/`
- 最后更新：2026-09-12

---

## 〇、四个接口速览

| # | 方法 | 路径 | 作用 | 是否调用 MiMo |
|---|---|---|---|:---:|
| 1 | GET | `/` | 根路径，确认服务存活与当前模型名 | ❌ |
| 2 | GET | `/health` | 健康检查 + Key 是否已配置 | ❌ |
| 3 | POST | `/agent/generate` | 一次性生成完整内容 | ✅ |
| 4 | POST | `/agent/stream` | SSE 流式逐段生成 | ✅ |

---

## 一、所有接口共用的底层文件

不管请求哪个接口，Python 导入机制和 FastAPI 运行时都会先经过这些文件：

| 顺序 | 文件 | 在链路中的作用 |
|---|---|---|
| 0 | [.env](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/.env) | 环境变量来源（Key、Base URL、模型名、端口） |
| 1 | [app/__init__.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/__init__.py) | 顶层包标识，使 `app.xxx` 可被导入 |
| 2 | [app/main.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/main.py) | FastAPI 应用、CORS、4 个路由的注册处 |
| 3 | [app/core/__init__.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/core/__init__.py) | core 包标识 |
| 4 | [app/core/config.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/core/config.py) | 读取 `.env` 生成全局单例 `settings`（[L49](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/core/config.py#L49)） |
| 5 | 第三方库（`.venv`） | `fastapi` / `pydantic` / `starlette` / `uvicorn` 提供路由、校验、HTTP 服务，不属于项目代码 |

---

## 二、接口 1：GET `/`

### 完整文件链路

```
HTTP 请求 GET /
   │
   ▼
uvicorn（.venv 第三方）  ── 接收 TCP/HTTP
   │
   ▼
app/main.py  ::  root()                         [L33-L36]
   │  读取 settings.MIMO_MODEL
   ▼
app/core/config.py  ::  settings 单例           [L33 字段 / L49 实例]
   │  pydantic-settings 在进程启动时已读入
   ▼
.env  ::  MIMO_MODEL=mimo-v2.5-pro              [L28]
   │
   ▼
返回 {"status":"ok","service":"ai-creator-agent","model":"mimo-v2.5-pro"}
```

### 涉及文件清单

| 文件 | 用到的内容 |
|---|---|
| [app/main.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/main.py#L33-L36) | `root()` 函数 |
| [app/core/config.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/core/config.py#L33) | `settings.MIMO_MODEL` |
| [.env](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/.env#L28) | `MIMO_MODEL` 的实际值 |

**不经过**：schemas、agents、models/gateway、providers。

---

## 三、接口 2：GET `/health`

### 完整文件链路

```
HTTP 请求 GET /health
   │
   ▼
app/main.py  ::  health()                       [L39-L42]
   │  调用 ModelGateway.is_configured()
   ▼
app/models/__init__.py                          （models 包标识，导入时经过）
   │
   ▼
app/models/gateway.py  ::  ModelGateway.is_configured()   [L23-L26]
   │  判断 settings.MIMO_API_KEY 是否为空/占位符
   ▼
app/core/config.py  ::  settings                [L31 MIMO_API_KEY 字段]
   │
   ▼
.env  ::  MIMO_API_KEY=sk-...                   [L25]
   │
   ▼
返回 {"status":"healthy","model_configured":true}
```

### 涉及文件清单

| 文件 | 用到的内容 |
|---|---|
| [app/main.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/main.py#L39-L42) | `health()` 函数 |
| [app/models/gateway.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/models/gateway.py#L23-L26) | `is_configured()` 静态方法 |
| [app/core/config.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/core/config.py#L31) | `settings.MIMO_API_KEY` |
| [.env](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/.env#L25) | `MIMO_API_KEY` 的实际值 |

**注意**：只"读取配置判断"，**不创建客户端、不联网**，所以 Key 填错这个接口也返回 healthy/true。

---

## 四、接口 3：POST `/agent/generate`（一次性生成）

### 完整文件链路（从请求到 MiMo 再回到浏览器）

```
浏览器/测试工具  POST  JSON: {"prompt":"...","max_completion_tokens":2048}
   │
   ▼
uvicorn + FastAPI（.venv）
   │
   ├─► app/schemas/__init__.py                 （schemas 包标识）
   ├─► app/schemas/Data_type.py :: GenerateRequest [L7-L14]
   │       pydantic 校验请求体（prompt 必填非空、token 范围 1~8192）
   │
   ▼
app/main.py :: agent_generate(req)              [L45-L65]
   │  ① ModelGateway.is_configured() 检查 → 不过则 503
   │  ② WriterAgent(model=req.model)
   ▼
app/agents/__init__.py                          （agents 包标识）
   │
   ▼
app/agents/writer.py :: WriterAgent.write()     [L20-L24]
   │  附加写作 system prompt（WRITER_SYSTEM_PROMPT [L7-L10]）
   │  转调 gateway.generate()
   ▼
app/models/__init__.py
   │
   ▼
app/models/gateway.py :: ModelGateway           [L14]
   │  ├─ __init__：self.model = 配置模型        [L17-L21]
   │  ├─ is_configured() 占位符拦截             [L23-L26]
   │  ├─ _build_messages() 组装 system+user     [L28-L35]
   │  └─ generate() 发起非流式请求              [L37-L59]
   │           实际请求语句在 L50：
   │           await self._client.chat.completions.create(..., stream=False)
   ▼
app/models/providers.py :: get_mimo_async_client()  [L34-L36]
   │  └─ get_mimo_kwargs() 取 Key + Base URL    [L21-L26]
   │  创建 openai 官方 SDK 的 AsyncOpenAI 实例
   ▼
app/core/config.py :: settings                  [L31-L33]
   │
   ▼
.env                                            [L25 Key / L26 Base URL / L28 Model]
   │
   ▼
第三方库 openai SDK + httpx（.venv）
   │  发出真实 HTTPS 请求：
   │  POST https://api.xiaomimimo.com/v1/chat/completions
   │  Header: Authorization: Bearer sk-xxx
   ▼
小米 MiMo 服务器（外部服务，非本项目）
   │  返回完整 JSON：choices[0].message.content
   ▼
沿原路返回：
providers(SDK) → gateway 取 content [L59] → writer → main.py
   │
   ├─ 失败：main.py 捕获异常 → HTTPException 502         [L60-L62]
   └─ 成功：app/schemas/Data_type.py :: GenerateResponse     [L17-L21]
              pydantic 序列化 → JSON 响应
   ▼
{"model":"mimo-v2.5-pro","content":"……完整正文……"}
```

### 涉及文件清单（共 7 个项目文件 + 1 个配置）

| 顺序 | 文件 | 用到的内容 |
|---|---|---|
| 1 | [app/main.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/main.py#L45-L65) | 路由 `agent_generate()`、503/502 处理 |
| 2 | [app/schemas/Data_type.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/schemas/Data_type.py#L7-L21) | `GenerateRequest` 入参校验、`GenerateResponse` 出参契约 |
| 3 | [app/agents/writer.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/agents/writer.py#L7-L24) | 写作人设、`write()` 转调网关 |
| 4 | [app/models/gateway.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/models/gateway.py#L14-L59) | 消息组装、配置检查、**真实请求 L50**、取正文 |
| 5 | [app/models/providers.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/models/providers.py#L21-L36) | 创建指向 MiMo 的 OpenAI 异步客户端 |
| 6 | [app/core/config.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/core/config.py#L31-L33) | 提供 Key / Base URL / Model |
| 7 | [.env](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/.env#L25-L28) | 三项 MiMo 配置的真实值 |
| — | 包标识文件 | app / agents / models / schemas 的 `__init__.py`（导入时经过） |
| — | 第三方 | `openai`、`httpx`（位于 `.venv`）→ 小米 MiMo 服务器 |

---

## 五、接口 4：POST `/agent/stream`（SSE 流式生成）

### 完整文件链路

与接口 3 大部分文件相同，区别在 main.py 的 SSE 包装层和 gateway 的流式分支：

```
浏览器/测试工具  POST  JSON（同接口3的请求体）
   │
   ▼
app/schemas/Data_type.py :: GenerateRequest        [L7-L14]   校验请求体
   │
   ▼
app/main.py :: agent_stream(req)                [L68-L99]
   │  ① 进流式前先做 is_configured() 检查 → 不过则 503   [L72-L76]
   │  ② 定义异步生成器 event_generator()        [L78-L92]（此刻不执行）
   │  ③ StreamingResponse 挂到 HTTP 长连接      [L95-L99]
   │        响应头：Content-Type: text/event-stream
   │                Cache-Control: no-cache
   │                X-Accel-Buffering: no
   ▼
app/agents/writer.py :: WriterAgent.write_stream()   [L26-L31]
   │  透传写作人设，async for 逐段 yield
   ▼
app/models/gateway.py :: ModelGateway.stream()       [L61-L91]
   │  ├─ L74 真实流式请求：create(..., stream=True)
   │  ├─ async for chunk：逐块接收 SDK 分片
   │  ├─ 过滤空 choices 帧                         [L83-L85]
   │  └─ 只取 delta.content，丢弃 reasoning_content 思考内容 [L86-L91]
   ▼
app/models/providers.py :: AsyncOpenAI 客户端        [L34-L36]
   ▼
app/core/config.py → .env（Key/BaseURL/Model）
   ▼
openai SDK + httpx（.venv）
   │  POST https://api.xiaomimimo.com/v1/chat/completions  （stream:true）
   ▼
小米 MiMo 服务器 ── 分片持续返回（不是一次性返回）
   │
   ▼ 每一片沿原路回到 main.py 的 event_generator()：
   ├─ 正常片：包装为 SSE 帧并立即 yield            [L87]
   │          data: {"chunk": "春雨"}\n\n
   ├─ 全部结束：yield 结束标记                     [L89]
   │          data: [DONE]\n\n
   └─ 中途异常：yield 错误帧（此时无法改 HTTP 状态码）[L90-L92]
              data: {"error": "..."}\n\n
   ▼
uvicorn 每次 yield 立即 flush 到 TCP → 浏览器实时收到
```

### 涉及文件清单（共 7 个项目文件 + 1 个配置）

| 顺序 | 文件 | 用到的内容 |
|---|---|---|
| 1 | [app/main.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/main.py#L68-L99) | 路由、`event_generator()`、`StreamingResponse`、SSE 帧格式与错误帧 |
| 2 | [app/schemas/Data_type.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/schemas/Data_type.py#L7-L14) | 仅用 `GenerateRequest`（流式无 `GenerateResponse`，输出是 SSE 文本） |
| 3 | [app/agents/writer.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/agents/writer.py#L26-L31) | `write_stream()` 异步透传 |
| 4 | [app/models/gateway.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/models/gateway.py#L61-L91) | **真实流式请求 L74**、空帧/思考内容过滤、逐块 yield |
| 5 | [app/models/providers.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/models/providers.py#L34-L36) | 同一个 AsyncOpenAI MiMo 客户端 |
| 6 | [app/core/config.py](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/app/core/config.py#L31-L33) | Key / Base URL / Model |
| 7 | [.env](file:///c:/Users/11720/Desktop/团队技术部/agent/backend/python/.env#L25-L28) | 配置真实值 |
| — | 第三方/外部 | `openai`、`httpx`（.venv）→ 小米 MiMo 服务器 |

---

## 六、四个接口文件依赖差异对照

| 文件 | GET `/` | GET `/health` | POST `/agent/generate` | POST `/agent/stream` |
|---|:---:|:---:|:---:|:---:|
| app/main.py | ✅ root | ✅ health | ✅ generate | ✅ stream |
| app/core/config.py | ✅ | ✅ | ✅ | ✅ |
| .env | ✅ MIMO_MODEL | ✅ MIMO_API_KEY | ✅ 三项 | ✅ 三项 |
| app/models/gateway.py | — | ✅ is_configured | ✅ generate | ✅ stream |
| app/models/providers.py | — | — | ✅ 创建客户端 | ✅ 创建客户端 |
| app/agents/writer.py | — | — | ✅ write | ✅ write_stream |
| app/schemas/Data_type.py | — | — | ✅ Request+Response | ✅ 仅 Request |
| 外部 MiMo 服务器 | — | — | ✅ 非流式 | ✅ 流式 |
| 包 `__init__.py` | app、core | +models | +agents、schemas | +agents、schemas |

---

## 七、补充：队列异步任务的另一条链（非 HTTP 接口，供对照）

RQ worker 消费任务时**不经过 main.py**，链路为：

```
Redis 队列 creation_tasks
   ▼
app/core/queue.py :: enqueue_task() 投递端（[L15-L31]）
   ▼
app/services/creation.py :: process_task()（同步入口 [L54]）
        → _run_creation()（异步 [L13]）
   ▼
app/agents/writer.py :: write_stream()
   ▼
app/models/gateway.py :: stream()（真实请求 L74）
   ▼
app/models/providers.py → config.py → .env → MiMo
   ▼
每段 publish 到 Redis 频道 task:{id}:stream（[creation.py L31-L41]）
最终状态/结果写回 Redis（[L46-L50]）
```

---

## 八、一句话记忆

- 所有接口的"公共底座"：`main.py` + `core/config.py` + `.env`
- 凡是真出内容的接口：再加 `schemas/Data_type.py → agents/writer.py → models/gateway.py → models/providers.py → openai SDK → MiMo`
- `generate` 与 `stream` 的唯一本质区别：gateway 里 `stream=False/True`，以及 main.py 里用普通返回还是 `StreamingResponse + yield`
