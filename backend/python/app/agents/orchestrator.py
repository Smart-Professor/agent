"""协调器：任务拆解与调度（待实现）

负责把一个创作任务拆解为多个步骤，调度 Writer / Reviewer，
并在执行过程中把流式结果推送到 Redis 频道 task:{id}:stream。
"""
from typing import Any, Dict  # 任意类型 / 字典类型


class Orchestrator:
    """多步创作编排器（写作 → 审校 → 汇总），当前为占位骨架。"""

    def __init__(self):
        # TODO: 初始化 WriterAgent / ReviewerAgent / ModelGateway
        pass

    async def run(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """执行完整创作编排流程并返回结果字典。"""
        # TODO: 实现完整创作编排流程（拆解、调度 Writer/Reviewer、推送进度）
        raise NotImplementedError("Orchestrator.run 尚未实现")
