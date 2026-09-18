"""运行方式：python -m app.planning.demo"""

from .planner import SimplePlanner


def main() -> None:
    planner = SimplePlanner()
    plan = planner.plan("为用户生成一份科幻短篇故事创作方案")

    print(f"任务目标：{plan.goal}\n")
    print("执行计划：")
    for step in plan.steps:
        print(f"{step.order}. {step.title}")
        print(f"   动作：{step.action}")
        print(f"   预期：{step.expected_result}")


if __name__ == "__main__":
    main()
