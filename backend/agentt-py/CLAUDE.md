# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

基于 GLM-5.3 Flash（智谱开放平台）的多 Agent 创作系统，采用 LangGraph Supervisor 主管模式：1 个主管（supervisor）调度 5 个创作 Agent（story / character / scene / storyboard / interaction），通过 FastAPI 提供 SSE 流式对话接口。所有代码注释与提示词均为中文，新增代码请保持中文注释风格。

代码按 Agent 四大能力（规划 / 记忆 / 工具 / 行动）组织在 `app/` 下：`app/planning/`（Supervisor 调度 + SimplePlanner）、`app/memory/`（共享状态）、`app/tools/`（文生图）、`app/action/`（worker 执行 + 模型客户端 + 提示词），另有 `app/config.py` 与 `app/graph.py` 两个公共服务文件留在顶层。结构与开发约定见 `ARCHITECTURE.md`。

## 常用命令

```bash
# 安装依赖
pip install -r requirements.txt

# 配置：复制 .env.example 为 .env，填入 ZHIPUAI_API_KEY（https://open.bigmodel.cn 获取）
copy .env.example .env    # Windows；Linux/Mac 用 cp

# 启动服务（浏览器打开 http://localhost:8000 有内置查看页）
uvicorn main:app --reload

# 冒烟测试（无需 API Key，用脚本化假 LLM 验证图结构与路由逻辑）
python smoke_test.py

# 规划模块演示（无需 API Key，打印 SimplePlanner 生成的计划）
python -m app.planning.demo

# 手动测 SSE 接口（-N 关闭 curl 缓冲，实时看流）
curl -N -X POST http://localhost:8000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "写一个武侠短篇故事并设计主角", "thread_id": "t1"}'
```

没有单元测试框架，`smoke_test.py` 是唯一的自动化验证手段——改动 supervisor/workers/graph 后必须跑一遍。

## 架构

### 图结构（app/graph.py）

```
START → supervisor ──(route 条件边)──→ story / character / scene / storyboard / interaction
            ▲                              │
            └──────────────────────────────┘   （每个 worker 干完活回到 supervisor）
supervisor 输出 next_agent=FINISH → END
```

- `build_graph()` 用 `@lru_cache` 做单例，编译时挂 `InMemorySaver` checkpointer；`thread_id` 区分会话，实现互动叙事的多轮记忆（进程重启即清空，持久化可换 `SqliteSaver`）。
- `main.py` 每次请求把 `steps` 重置为 0（否则 checkpointer 里累计的步数会立即触发上限）；而 `messages`/`artifacts` 会随 `thread_id` 保留，这正是互动叙事记忆的来源。

### 一轮调度的数据流

1. `supervisor_node`（app/planning/supervisor.py）：把用户输入 + artifacts 摘要（每项截 200 字）+ 最近 6 条 worker 简报拼成材料（`_digest`），用 `with_structured_output(Decision)` 让 LLM 输出 `{next, instruction, reason}`。模型不支持 function calling 时回退到正则抠 JSON（`_parse_decision`）。非法路由值强制 FINISH。主管用 temperature=0.2，不流式输出。
2. `route`（app/planning/supervisor.py）：条件边，`steps > MAX_STEPS(12)` 时强制结束，防死循环。
3. worker 节点（app/action/workers.py）：由 `_make_worker` 按 `WORKER_SPECS` 工厂生成。每个 worker 一次 LLM 调用（temperature=0.8，流式）：读主管指令 + `WORKER_SPECS` 指定的 context 素材 → 产出写入 `artifacts[spec["artifact"]]`。
4. 后处理约定（靠提示词里的固定行格式 + 正则截取，不是结构化输出）：
   - `IMAGE_PROMPT: ...` 行 → 截出后调 `generate_image`（CogView）生图，从正文删除，单次最多 `MAX_IMAGES=3` 张，失败记录 error 不中断。
   - `WORLD_STATE: ...` 行（仅 interaction）→ 截出写入 `artifacts["world_state"]`，作为跨轮世界观记忆。

### SSE 协议（main.py）

`POST /chat/stream` 用 `graph.astream(stream_mode=["updates", "messages"])` 双模式流：`updates` 产出 `route`/`node_done` 事件，`messages` 产出 worker 的逐 token `token` 事件（主管走结构化输出，不流式）。事件顺序：`start → route → token* → node_done → ... → final → end`。前端 `static/index.html` 手写 SSE 解析。

### 四大件结构与规划模块

`app/` 按 Agent 四大能力组织，依赖方向无循环：

```
graph → planning.supervisor → action.llm / action.prompts / memory.state
graph → action.workers      → action.llm / action.prompts / memory.state / tools.image
tools.image → config
action.llm  → config
```

`app/planning/` 中的任务规划模块：

- `planner.py`：`PlanStep` / `Plan`（frozen dataclass）+ `SimplePlanner.plan(goal) -> Plan`，纯规则生成"理解需求 → 拆解任务 → 执行与记录 → 验收与交付"四步计划，不调用 LLM；`goal` 为空时抛 `ValueError`。后续接模型只替换 `SimplePlanner.plan` 的生成逻辑，数据结构保持不变。
- `demo.py`：`python -m app.planning.demo` 打印示例计划。

新增 Agent 能力按 `ARCHITECTURE.md` 的约定写进对应四大件目录，不要在 `app/` 顶层新增逻辑文件。

## 各文件说明

| 文件 | 作用 |
|---|---|
| `main.py` | FastAPI 入口。`/health` 健康检查（返回模型名）；`POST /chat/stream` SSE 流式对话；把 `static/` 挂载到 `/` 作为查看页。定义 7 种 SSE 事件。 |
| `app/config.py` | 全局配置：`load_dotenv` 读根目录 `.env`，导出 `API_KEY` / `BASE_URL` / `MODEL` / `IMAGE_MODEL`；`require_api_key()` 未配置时抛中文报错。 |
| `app/action/llm.py` | `get_llm(temperature=0.8)` 返回 `ChatOpenAI` 实例（`lru_cache` 缓存），指向智谱的 OpenAI 兼容地址，`streaming=True`。 |
| `app/memory/state.py` | `AgentState` TypedDict，全部节点的共享状态：`messages`（add_messages 累加）、`user_input`、`instruction`（主管→worker 指令）、`next_agent`（路由结果）、`artifacts`（产物字典）、`reports`（operator.add 累加的 worker 简报）、`images`（生图记录）、`steps`（调度轮数）。 |
| `app/action/prompts.py` | 6 个 Agent 的系统提示词：`SUPERVISOR_PROMPT`（含调度规则与 JSON 输出格式）+ `WORKER_PROMPTS` 字典（story/character/scene/storyboard/interaction，内含 IMAGE_PROMPT / WORLD_STATE 行格式约定）。 |
| `app/tools/image.py` | `generate_image(prompt) -> url`：用 OpenAI 兼容接口调 CogView 文生图。换 SDXL/自建服务只改这个函数，签名不变。 |
| `app/planning/supervisor.py` | 主管节点：`WORKERS` 列表（worker 名字的唯一权威来源，main.py 也从这里导入）、`MAX_STEPS=12`、`Decision` 模型、`supervisor_node`、`_digest`/`_parse_decision`、`route` 条件路由。 |
| `app/action/workers.py` | 5 个创作 Agent：`WORKER_SPECS` 声明每个 worker 的产物字段、要读的 context 素材、是否生图/维护世界观；`_make_worker` 工厂生成节点函数；`_run_images` 截取 IMAGE_PROMPT 行并生图。 |
| `app/graph.py` | LangGraph 组装：注册 supervisor + workers 节点，START→supervisor，supervisor 条件边分发，worker 无条件回 supervisor，`InMemorySaver` checkpointer。 |
| `smoke_test.py` | 无 key 冒烟测试：`ScriptedLLM`（继承 BaseChatModel，按脚本顺序返回预设文本）patch 掉真实 LLM 和生图，断言路由链、产物合并、IMAGE_PROMPT/WORLD_STATE 截取、消息历史。 |
| `static/index.html` | 极简前端查看页：手写 SSE 解析，按 agent 着色显示流式气泡、生图结果、final 产物折叠面板。无构建步骤，纯静态。 |
| `app/planning/planner.py` | 规划模块：`Plan` / `PlanStep` + `SimplePlanner`，规则型四步计划生成，不依赖 LLM。 |
| `app/planning/demo.py` | 规划模块演示入口：`python -m app.planning.demo`。 |
| `.env.example` | 环境变量模板：`ZHIPUAI_API_KEY`（必填）、`GLM_MODEL`、`GLM_IMAGE_MODEL`、`GLM_BASE_URL`。 |

## 扩展点

**加一个新 worker** 需要改 3 处（main.py 不用动，它从 supervisor 导入 `WORKERS`）：

1. `app/action/prompts.py`：新增提示词并加入 `WORKER_PROMPTS`；
2. `app/action/workers.py`：`WORKER_SPECS` 加一项（指定 `artifact` 存哪、`context` 读哪些素材、是否 `image`/`world`）；
3. `app/planning/supervisor.py`：`WORKERS` 列表加名字，并在 `SUPERVISOR_PROMPT` 的可调度 Agent 列表里补一行。

**换生图后端**：只改 `app/tools/image.py` 的 `generate_image`，签名 `(prompt) -> url` 不变。

**换模型**：改 `.env` 的 `GLM_MODEL` / `GLM_IMAGE_MODEL`；模型名不对智谱会报 404/400。

## 注意事项

- 模型名 `.env` 默认 `glm-5.3-flash` / `cogview-3-flash`；`SUPERVISOR_PROMPT` 里写的"最多 8 轮"是给 LLM 的软提示，代码硬上限是 `MAX_STEPS=12`，两者不一致是有意的（提示词引导收敛，代码兜底）。
- `app/action/llm.py` 的 `get_llm` 按 temperature 缓存实例，worker 流式输出依赖 `streaming=True`，不要关掉。
- supervisor 的 `messages` 更新以 `[调度] next：reason` 格式写入对话历史，前端按 `name` 字段区分消息来源。
