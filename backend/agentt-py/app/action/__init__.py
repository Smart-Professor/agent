"""行动能力：执行创作任务（模型客户端、提示词、worker 节点）。"""

from .workers import WORKER_SPECS, build_workers  # 导出 worker 节点工厂与各 worker 的素材配置表

__all__ = ["build_workers", "WORKER_SPECS"]  # 声明包对外暴露的公共接口
