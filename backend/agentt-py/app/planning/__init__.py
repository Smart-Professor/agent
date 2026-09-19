"""规划能力：Supervisor 调度决策与任务规划。"""

from .planner import Plan, PlanStep, SimplePlanner  # 导出规划器数据结构与规则型实现
from .supervisor import MAX_STEPS, WORKERS, route, supervisor_node  # 导出主管节点、worker 名单、轮数上限与路由函数

__all__ = ["Plan", "PlanStep", "SimplePlanner", "WORKERS", "MAX_STEPS", "route", "supervisor_node"]  # 声明包对外暴露的公共接口
