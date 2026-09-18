"""最小任务规划器：将目标转成可展示、可执行、可验收的步骤。

这是不依赖 LLM 的演示实现。后续接入模型时，可保持 Plan / PlanStep 数据结构不变，
仅替换 SimplePlanner.plan 的计划生成逻辑。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PlanStep:
    """计划中的单个步骤。"""

    order: int
    title: str
    action: str
    expected_result: str


@dataclass(frozen=True)
class Plan:
    
    """一次任务规划的结果。"""

    goal: str
    steps: list[PlanStep]


class SimplePlanner:
    """用于验证规划模块输入、输出与展示方式的规则型规划器。"""

    def plan(self, goal: str) -> Plan:
        """基于目标生成最小闭环计划。"""
        clean_goal = goal.strip()
        if not clean_goal:
            raise ValueError("任务目标不能为空")

        return Plan(
            goal=clean_goal,
            steps=[
                PlanStep(
                    order=1,
                    title="理解需求",
                    action=f"识别目标“{clean_goal}”的范围、输入和约束。",
                    expected_result="得到明确的任务边界与验收标准。",
                ),
                PlanStep(
                    order=2,
                    title="拆解任务",
                    action="将目标拆为按依赖顺序执行的子任务，并标记所需资源。",
                    expected_result="得到可逐项执行的任务清单。",
                ),
                PlanStep(
                    order=3,
                    title="执行与记录",
                    action="依次执行子任务，记录中间结果、失败原因和待确认项。",
                    expected_result="产出可追踪的阶段性结果。",
                ),
                PlanStep(
                    order=4,
                    title="验收与交付",
                    action="根据验收标准检查结果，修正问题并整理最终输出。",
                    expected_result="交付满足目标的最终结果。",
                ),
            ],
        )
