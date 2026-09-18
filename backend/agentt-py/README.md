# AI 创作多智能体（LangChain + LangGraph，Supervisor 主管模式）

基于 GLM-5.3 Flash 的多 Agent 创作系统：1 个主管调度 5 个创作 Agent，SSE 流式输出对话过程。

```
                         ┌─────────┐
          START ────────▶│Supervisor│────────▶ END (FINISH)
                         └────┬────┘
        ┌──────────┬──────────┼──────────┬──────────┐
        ▼          ▼          ▼          ▼          ▼
     📖story   👤character  🏞️scene  🎬storyboard 🎮interaction
        └──────────┴──────────┴────┬─────┴──────────┘
                                   ▼ (每个 worker 干完活回到主管)
                             Supervisor 校验一致性、决定下一轮
```

| Agent | 职责 | 产物 (artifacts) |
|---|---|---|
| Supervisor | 解析需求、规划调度、一致性校验 | 路由决策 |
| StoryAgent | 故事正文、分支剧情 | `story` |
| CharacterAgent | 人设/背景/台词 + 文生图角色立绘 | `characters` |
| SceneAgent | 场景描述 + 场景概念图 | `scenes` |
| StoryboardAgent | 分镜脚本（引用已有角色/场景） | `storyboard` |
| InteractionAgent | 互动叙事、维护世界观状态 | `interaction` + `world_state` |

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 配置 API Key
copy .env.example .env      # Windows；Linux/Mac 用 cp
# 编辑 .env，填入 ZHIPUAI_API_KEY（https://open.bigmodel.cn 获取）

# 3. 启动
uvicorn main:app --reload
```

打开 http://localhost:8000 即可查看流式效果；输入如：
> 以星际港口为背景写个故事，设计主角和主要场景，再出分镜

## SSE 接口

`POST /chat/stream`，请求体 `{"message": "...", "thread_id": "default"}`（thread_id 区分会话，互动叙事靠它记住之前的剧情）。

curl 示例（`-N` 关闭缓冲，实时看流）：

```bash
curl -N -X POST http://localhost:8000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "写一个武侠短篇故事并设计主角", "thread_id": "t1"}'
```

SSE 事件流：

| 事件 | 数据 | 说明 |
|---|---|---|
| `start` | `{thread_id}` | 会话开始 |
| `route` | `{next, instruction, reason}` | 主管调度决策（next=worker名 或 FINISH） |
| `token` | `{node, text}` | worker 逐 token 输出 |
| `node_done` | `{node, images}` | worker 完成，附生图结果 |
| `final` | `{artifacts, images}` | 本次请求全部产物 |
| `error` | `{message}` | 出错 |
| `end` | `{}` | 结束 |

## 目录结构

```
├── main.py            # FastAPI 入口：SSE 接口 + 静态页
├── static/index.html  # 极简查看页
├── smoke_test.py      # 无 key 冒烟测试（假 LLM 验证图结构）：python smoke_test.py
├── ARCHITECTURE.md    # 目标分层与迁移约定
└── app/
    ├── config.py      # 读 .env
    ├── llm.py         # GLM 客户端（ChatOpenAI + 智谱 OpenAI 兼容地址）
    ├── state.py       # AgentState 共享状态
    ├── prompts.py     # 6 个 Agent 提示词
    ├── tools.py       # 文生图（CogView）
    ├── supervisor.py  # 主管节点 + 路由
    ├── workers.py     # 5 个创作 Agent 节点
    ├── graph.py       # LangGraph 组装
    ├── agent/          # 目标分层骨架（迁移中）
    │   ├── role/       #   角色、提示词、推理、知识（占位）
    │   ├── planning/   #   任务规划：已实现 SimplePlanner
    │   ├── memory/     #   短期/长期记忆、用户画像（占位）
    │   └── tools/      #   工具定义/注册/外部适配（占位）
    ├── api/            #   路由与鉴权（占位）
    ├── orchestration/  #   Supervisor/Worker 编排（占位）
    ├── models/         #   模型 Provider 适配（占位）
    ├── schemas/        #   数据契约（占位）
    └── infrastructure/ #   Redis/数据库/对象存储（占位）
```

> 运行时仍走 `main.py` + `app/*.py` 的扁平结构；`agent/`、`api/`、`orchestration/` 等分层目录是按 `ARCHITECTURE.md` 预建的骨架，目前只有 `app/agent/planning/` 有实现，其余仅 `__init__.py` / `.gitkeep` 占位。

## 说明与扩展

- **任务规划**：`app/agent/planning/` 提供不依赖 LLM 的 `SimplePlanner`（`Plan` / `PlanStep`），演示 `python -m app.agent.planning.demo`；后续接模型只替换计划生成逻辑。
- **换生图后端**：改 `app/tools.py` 的 `generate_image()` 即可（签名 `(prompt) -> url` 不变），SDXL / 3DGS 接进同一个函数。
- **防死循环**：主管单次请求最多调度 12 轮（`app/supervisor.py: MAX_STEPS`）。
- **模型名**：`.env` 里 `GLM_MODEL` / `GLM_IMAGE_MODEL` 可改；模型名不对会报 404/400，按智谱控制台的模型列表填。
- **会话记忆**：内存 checkpointer，进程重启后清空；要持久化可换 `SqliteSaver`。
- **主管结构化输出**：优先 function calling，模型不支持时自动回退到 JSON 文本解析。
