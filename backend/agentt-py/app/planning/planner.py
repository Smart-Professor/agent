"""最小任务规划器：将目标转成可展示、可执行、可验收的步骤。

这是不依赖 LLM 的演示实现。后续接入模型时，可保持 Plan / PlanStep 数据结构不变，
仅替换 SimplePlanner.plan 的计划生成逻辑。
"""

from dataclasses import dataclass  # 导入 dataclass，用声明式方式定义不可变数据结构


@dataclass(frozen=True)  # frozen=True：实例不可变，防止计划步骤被意外修改
class PlanStep:  # 计划步骤的数据结构
    """计划中的单个步骤。"""

    order: int  # 步骤序号（从 1 开始）
    title: str  # 步骤标题（展示用）
    action: str  # 要执行的具体动作
    expected_result: str  # 完成后的预期结果（验收标准）


@dataclass(frozen=True)  # frozen=True：计划整体同样不可变
class Plan:  # 一次任务规划的结果
    """一次任务规划的结果。"""

    goal: str  # 清洗后的任务目标
    steps: list[PlanStep]  # 按顺序排列的步骤列表


class SimplePlanner:  # 规则型规划器实现
    """用于验证规划模块输入、输出与展示方式的规则型规划器。"""

    def plan(self, goal: str) -> Plan:  # 把目标转成固定四步的最小闭环计划
        """基于目标生成最小闭环计划。"""
        clean_goal = goal.strip()  # 去除目标首尾空白
        if not clean_goal:  # 空目标无法规划，直接报错
            raise ValueError("任务目标不能为空")  # 抛出值错误，提示调用方传入有效目标

        return Plan(  # 返回固定四步计划
            goal=clean_goal,  # 记录清洗后的目标
            steps=[  # 步骤列表
                PlanStep(  # 第 1 步：理解需求
                    order=1,  # 步骤序号
                    title="理解需求",  # 步骤标题
                    action=f"识别目标“{clean_goal}”的范围、输入和约束。",  # 动作：把目标带入，明确边界
                    expected_result="得到明确的任务边界与验收标准。",  # 预期结果
                ),
                PlanStep(  # 第 2 步：拆解任务
                    order=2,  # 步骤序号
                    title="拆解任务",  # 步骤标题
                    action="将目标拆为按依赖顺序执行的子任务，并标记所需资源。",  # 动作：任务拆分与资源标记
                    expected_result="得到可逐项执行的任务清单。",  # 预期结果
                ),
                PlanStep(  # 第 3 步：执行与记录
                    order=3,  # 步骤序号
                    title="执行与记录",  # 步骤标题
                    action="依次执行子任务，记录中间结果、失败原因和待确认项。",  # 动作：执行并留痕
                    expected_result="产出可追踪的阶段性结果。",  # 预期结果
                ),
                PlanStep(  # 第 4 步：验收与交付
                    order=4,  # 步骤序号
                    title="验收与交付",  # 步骤标题
                    action="根据验收标准检查结果，修正问题并整理最终输出。",  # 动作：验收与修正
                    expected_result="交付满足目标的最终结果。",  # 预期结果
                ),
            ],
        )
