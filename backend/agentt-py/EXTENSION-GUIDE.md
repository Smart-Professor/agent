# agentt-py 拓展指南

> 本文档回答一个问题：**"我想在这个项目里加东西，该改哪些文件、怎么接、怎么验证。"**
>
> 适用范围：`agent/backend/agentt-py`（Supervisor 主管模式多智能体服务）
>
> 约定：项目未用 git 管理，**动手前先备份要改的文件**（参照 `_backup_20260919/` 的做法）。

---

## 〇、项目速览（先知道自己站在哪）

```
agentt-py/
├── app/
│   ├── planning/   规划：supervisor.py 主管调度 + planner.py 任务规划
│   ├── memory/     记忆：state.py 共享状态（所有 Agent 传数据的总线）
│   ├── tools/      工具：image.py 文生图（Agent 能调用的外部能力）
│   ├── action/     行动：llm.py 模型客户端 + prompts.py 提示词 + workers.py 执行节点
│   ├── config.py   全局配置（读 .env：API Key、模型名）
│   └── graph.py    总组装：把 supervisor 和 workers 连成 LangGraph
├── main.py         FastAPI 入口：SSE 流式接口 + 静态页
├── static/         前端查看页（index.html，单文件无构建）
├── smoke_test.py   无 Key 冒烟测试（假 LLM 跑通全链路）
└── .env.example    环境变量示例（复制为 .env 后填真实 Key）
```

一次请求的链路：

```
浏览器 → POST /chat/stream (main.py) → build_graph() (graph.py)
  → [supervisor 决策] ⇄ [worker 执行] 循环（最多 12 轮）
  → SSE 事件流（start/route/token/node_done/final/end）推回浏览器
```

---

## 一、加一个工具（Tool）

工具 = Agent 可调用的外部能力。现有参照：`app/tools/image.py`（文生图）。以加"音乐生成"为例。

### 1. 文件结构调整

```
app/tools/
├── __init__.py   ← 修改：导出新工具
├── image.py      ← 现有
└── music.py      ← 新建
```

### 2. 代码集成

新建 `app/tools/music.py`（参照 image.py 的模式：函数签名 `(输入: str) -> 输出: str`，失败抛异常由调用方兜底）：

```python
"""音乐生成工具：接入音乐生成 API。"""

from .. import config  # 读全局配置


def generate_music(prompt: str) -> str:
    """输入提示词，返回音乐 URL。失败抛异常，由调用方兜底。"""
    client = SomeClient(api_key=config.MUSIC_API_KEY, base_url=config.MUSIC_BASE_URL)
    resp = client.music.generate(prompt=prompt)
    return resp.data[0].url
```

在 `app/tools/__init__.py` 导出：

```python
from .image import generate_image
from .music import generate_music

__all__ = ["generate_image", "generate_music"]
```

### 3. 依赖

`pip install <服务的SDK>` 后，把包名和版本号追加到 `requirements.txt`。

### 4. 配置（三处配套）

| 文件 | 改什么 |
|---|---|
| `.env.example` | 加示例行 `MUSIC_API_KEY=your_key_here` |
| `.env`（真实） | 填入实际 Key |
| `app/config.py` | 加 `MUSIC_API_KEY = os.getenv("MUSIC_API_KEY", "").strip()` |

### 5. 让 worker 用上它

在 `app/action/workers.py` 里 `from ..tools.music import generate_music`，然后仿照 `_run_images`（L36-46）的模式：

- 约定产出里的特殊行（如 `IMAGE_PROMPT`）→ 正则截取 → try/except 逐条调用 → 结果写入返回的 dict
- 工具结果要进状态时，在 `node()` 返回的 dict 里加对应字段

### 6. 验证

```
python3 -m compileall -q app && python3 smoke_test.py
```

---

## 二、加一个创作环节（新 Worker Agent）

以加"音乐 Agent"为例，**共 4 处改动**。`graph.py` 和 `main.py` 不用动（`build_workers()` 遍历 `WORKER_SPECS` 自动注册）。

### 第 1 处：写系统提示词 — `app/action/prompts.py`

```python
MUSIC_PROMPT = """你是音乐创作 Agent。根据主管指令与故事素材创作配乐方案。
要求：
1. 输出曲名 | 风格 | 情绪 | 使用场景，每行一首。
2. 严格遵守已有故事与世界观设定。
"""
```

并注册到末尾 `WORKER_PROMPTS` 字典：

```python
"music": MUSIC_PROMPT,
```

### 第 2 处：加 worker 配置 — `app/action/workers.py` 的 `WORKER_SPECS`

```python
"music": {
    "artifact": "music",                                # 产出到 artifacts.music
    "context": ["story", "characters", "world_state"],  # 要读的已有素材
    "image": False,                                     # 产出含 IMAGE_PROMPT 行时才设 True
},
```

### 第 3 处：加路由名单 — `app/planning/supervisor.py`

```python
WORKERS = ["story", "character", "scene", "storyboard", "interaction", "music"]
```

### 第 4 处：改主管提示词 ⚠️ 最容易漏 — `app/action/prompts.py` 的 `SUPERVISOR_PROMPT`

- "可调度的 Agent"清单加一行：`- music: 音乐创作，...`
- JSON 输出格式的 `next` 枚举改为：`"next": "story|character|scene|storyboard|interaction|music|FINISH"`

主管是看着这段提示词做决策的，**提示词里没有它就永远不会被调度**。

### 验证

```
python3 smoke_test.py         # 无 Key：确认原有链路没被破坏
uvicorn main:app --reload     # 有 Key：真实链路
# 网页输入"写个故事并配乐"，观察是否出现 music 环节
```

---

## 三、加 MCP 接口

项目目前无 MCP 代码，两个方向都是**纯新增**，不碰现有文件。

### 方向 A：把项目能力暴露成 MCP Server（外部 AI 调你的能力）

**① 依赖**：`pip install fastmcp`，写入 `requirements.txt`。

**② 新建** `mcp_server.py`（项目根目录）：

```python
"""MCP Server：把项目工具暴露为标准 MCP 接口。运行：python mcp_server.py"""
from fastmcp import FastMCP

mcp = FastMCP("creator-tools")


@mcp.tool()
def generate_image(prompt: str) -> str:
    """文生图：输入提示词，返回图片 URL。"""
    from app.tools.image import generate_image
    return generate_image(prompt)


if __name__ == "__main__":
    mcp.run()  # stdio 传输
```

**③ 注册**：在 Trae / Claude Code 的 MCP 配置中添加此 stdio server（command 指向 python，args 指向 `mcp_server.py` 绝对路径）。

**④ 验证**：`python mcp_server.py` 启动不报错；在 AI 工具里能看到 `generate_image` 工具并能调用。

### 方向 B：项目作为 MCP Client（调外部 MCP 工具）

1. 依赖：`pip install mcp`，写入 `requirements.txt`
2. 在 `app/tools/` 新建封装文件（如 `mcp_client.py`）：用 `mcp` 库连接外部 server → `list_tools()` → `call_tool()` → 把结果包装成普通函数
3. 对 worker 暴露时保持 `(prompt: str) -> str` 签名，接入方式同【一、5】

> 建议先做方向 A：一个文件就能跑通。

---

## 四、加一个 Skill（给 Trae / Claude Code 用的技能）

先澄清概念：**skill 不是这个 Python 项目的代码**，是 AI 编程助手的能力包（一个带说明的文件夹，让 AI 在合适时机自动套用你的方法论）。

| 目标 | 走哪节 |
|---|---|
| 给"运行中的 Agent 程序"加能力 | 本文档【一】【二】 |
| 给"AI 编程助手"加能力 | 本节 |

### 操作步骤

**① 新建目录与文件**（放项目根目录，随项目走）：

```
agentt-py/skills/my-workflow/
└── SKILL.md
```

**② SKILL.md 写法**（frontmatter 的 `description` 决定 AI 何时触发，必须写清触发场景）：

```markdown
---
name: my-workflow
description: 当用户要求 XXX 时使用此技能，按固定流程完成 YYY
---

# 技能标题

## 什么时候用
...

## 步骤
1. ...
2. ...
```

**③ 验证**：重启 AI 助手会话，说一句命中 `description` 触发词的话，观察是否自动套用。

> 也可以直接对 Trae 说"帮我创建一个项目 skill"，走 skill-creator 流程生成。

---

## 五、其他常见扩展

### 加状态字段 — `app/memory/state.py` 的 `AgentState`

```python
my_field: str                                    # 普通字段：每轮整体覆盖
my_list: Annotated[list, operator.add]           # 累积列表：追加不覆盖
```

配套注意：谁写入它（worker 返回的 dict）、谁读它（`supervisor._digest` 或某 worker 的 `context`），并同步改提示词让模型知道新素材。

### 加 HTTP 接口 — `main.py`

```python
@app.post("/review")                    # 新路由
async def review(req: ChatRequest):     # 请求体复用或新建 pydantic 模型
    graph = build_graph()
    result = await graph.ainvoke(inputs, {"configurable": {"thread_id": "review"}})
    return {"artifacts": result.get("artifacts", {})}   # 非流式一次拿全量，适合调试
```

验证：启动后访问 `http://localhost:8000/docs`。

### 改前端 — `static/index.html`

单文件页面，通过 EventSource/fetch 消费 `/chat/stream` 的 SSE 事件。**新增 SSE 事件类型时**（`main.py` 里 `yield sse(...)`），记得在 index.html 的事件处理里同步添加，否则前端收不到。

---

## 六、通用验证清单（任何改动都适用）

1. 改动前备份被修改的文件到 `_backup_<日期>/`
2. `python3 -m compileall -q app main.py` — 编译无语法错
3. `python3 smoke_test.py` — 无 Key 跑通图结构与路由
4. `python3 -m app.planning.demo` — 无 Key 验证规划器
5. 新增依赖写入 `requirements.txt`；新 Key 同步 `.env.example`
6. 新增 SSE 事件/状态字段时，同步改 `static/index.html`
7. 最后 `uvicorn main:app --reload` 跑真实链路
