"""行动能力：执行创作任务（模型客户端、提示词、worker 节点）。"""

from .workers import WORKER_SPECS, build_workers

__all__ = ["build_workers", "WORKER_SPECS"]
