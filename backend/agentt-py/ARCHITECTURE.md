# Agent 服务架构（四大能力结构）

`backend/agentt-py` 是本项目唯一的正式 AI Agent 服务。`backend/python` 为旧 Agent 服务：在新服务完成 Redis 任务消费与 NestJS 联调前保留，只修复阻塞性问题，不再新增 Agent 能力。

## 目录结构

`app/` 按 Agent 四大能力（规划 / 记忆 / 工具 / 行动）组织：

| 目录/文件 | 职责 |
| --- | --- |
| `app/planning/` | **规划**：`supervisor.py` 主管调度决策（路由、一致性校验）；`planner.py` 任务规划器（SimplePlanner 演示实现）。 |
| `app/memory/` | **记忆**：`state.py` LangGraph 共享状态（AgentState），配合 graph.py 的 InMemorySaver 支撑多轮记忆。 |
| `app/tools/` | **工具**：`image.py` 文生图（智谱 CogView）。换图服务只需替换 generate_image 实现，签名不变。 |
| `app/action/` | **行动**：`workers.py` 5 个创作 worker 节点；`llm.py` 模型客户端；`prompts.py` 全部系统提示词。 |
| `app/config.py` | 全局配置：从 `.env` 读取 API Key 与模型名（公共服务，不属于四大件）。 |
| `app/graph.py` | LangGraph 总组装：START → supervisor ⇄ workers → END（公共服务，不属于四大件）。 |

## 依赖方向（无循环）

```
graph → planning.supervisor → action.llm / action.prompts / memory.state
graph → action.workers      → action.llm / action.prompts / memory.state / tools.image
tools.image → config
action.llm  → config
```

## 开发约定

1. 新的 Agent 能力按归属写入对应四大件目录，不再在 `app/` 顶层新增逻辑文件。
2. 对外入口保持不变：`main.py`（FastAPI + SSE）与 `smoke_test.py`（无 Key 冒烟测试）。
3. 工具替换原则：新工具放 `app/tools/`，保持"输入提示词 → 返回结果"的简单签名。

## 命名说明

当前目录名 `agentt-py` 为兼容现有路径而保留。待 NestJS 配置、部署脚本和文档全部切换完成后，再统一重命名为 `agent-py` 或 `creative-agent-service`。
