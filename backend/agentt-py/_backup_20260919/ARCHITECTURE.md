# Agent 服务架构与迁移约定

`backend/agentt-py` 是本项目唯一的正式 AI Agent 服务。`backend/python` 为旧 Agent 服务：在新服务完成 Redis 任务消费与 NestJS 联调前保留，只修复阻塞性问题，不再新增 Agent 能力。

## 目标分层

| 目录 | 职责 |
| --- | --- |
| `app/api/` | FastAPI 路由、SSE 和请求鉴权。 |
| `app/agent/role/` | 角色定义、提示词、推理策略与知识理解。 |
| `app/agent/planning/` | 目标澄清、任务拆解、计划执行状态。 |
| `app/agent/memory/` | 短期记忆、长期记忆、用户画像。 |
| `app/agent/tools/` | 工具定义、注册、权限控制和外部适配。 |
| `app/orchestration/` | LangGraph、Supervisor、Worker 与运行流编排。 |
| `app/models/` | 文本/图像模型的客户端与 Provider 适配。 |
| `app/infrastructure/` | Redis、数据库、对象存储及环境配置。 |
| `app/schemas/` | API、计划、记忆、工具调用的数据模型。 |

## 迁移顺序

1. 新的 Agent 能力只在 `app/agent/` 下开发。
2. 保持现有 `main.py`、`graph.py`、`supervisor.py`、`workers.py` 的接口和行为不变。
3. 通过小步迁移将编排逻辑移入 `app/orchestration/`，模型调用移入 `app/models/`，工具移入 `app/agent/tools/`。
4. 将 Redis 任务消费和 NestJS 调用接入本服务后，再归档 `backend/python`。

## 命名说明

当前目录名 `agentt-py` 为兼容现有路径而保留。待 NestJS 配置、部署脚本和文档全部切换完成后，再统一重命名为 `agent-py` 或 `creative-agent-service`。
