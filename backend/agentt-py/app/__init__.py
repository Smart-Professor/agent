"""Agent 服务包：按四大能力组织。

- planning/  规划：Supervisor 调度决策与任务规划
- memory/    记忆：共享状态与多轮对话记忆
- tools/     工具：可调用的外部能力（文生图等）
- action/    行动：模型客户端、提示词与 worker 执行
- config.py  全局配置；graph.py LangGraph 总组装
"""
