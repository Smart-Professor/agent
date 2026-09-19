"""运行方式：python -m app.planning.demo"""

from .planner import SimplePlanner  # 导入规则型规划器


def main() -> None:  # 演示入口：生成并打印一份创作方案
    planner = SimplePlanner()  # 实例化规划器
    plan = planner.plan("为用户生成一份科幻短篇故事创作方案")  # 用示例目标生成计划

    print(f"任务目标：{plan.goal}\n")  # 打印任务目标（含空行分隔）
    print("执行计划：")  # 打印计划标题
    for step in plan.steps:  # 遍历每个步骤
        print(f"{step.order}. {step.title}")  # 打印序号与标题
        print(f"   动作：{step.action}")  # 打印要执行的动作
        print(f"   预期：{step.expected_result}")  # 打印预期结果


if __name__ == "__main__":  # 直接运行本文件时（python -m 方式）
    main()  # 执行演示
