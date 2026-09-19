"""组装 LangGraph：START → supervisor ⇄ workers → END（Supervisor 主管模式）。"""

from functools import lru_cache  # 导入 lru_cache，用于把 build_graph 缓存成单例（图只构建一次）

from langgraph.checkpoint.memory import InMemorySaver  # 导入内存检查点，用于保存多轮会话状态
from langgraph.graph import END, START, StateGraph  # 导入 LangGraph 的终点/起点/状态图构造器

from .action.workers import build_workers  # 导入 worker 节点工厂（5 个创作 Agent）
from .memory.state import AgentState  # 导入共享状态定义（所有节点通过它传递数据）
from .planning.supervisor import MAX_STEPS, WORKERS, route, supervisor_node  # 导入主管节点、路由函数与常量


@lru_cache(maxsize=1)  # 缓存构建结果：整个进程复用同一个图实例，避免重复编译
def build_graph():  # 构建并编译 LangGraph 图的唯一入口
    builder = StateGraph(AgentState)  # 创建状态图，节点间通过 AgentState 传递与合并状态
    builder.add_node("supervisor", supervisor_node)  # 注册主管节点：负责解析需求与调度决策
    workers = build_workers()  # 构建 5 个 worker 节点（story/character/scene/storyboard/interaction）
    for name, node in workers.items():  # 遍历每个 worker
        builder.add_node(name, node)  # 把 worker 注册为图中的节点

    builder.add_edge(START, "supervisor")  # 入口边：每轮对话从 supervisor 开始
    builder.add_conditional_edges(  # 添加条件边：supervisor 之后走动态路由
        "supervisor",  # 条件边起点：supervisor 节点
        route,  # 路由函数：根据 state["next_agent"] 返回下一个节点名
        {**{name: name for name in workers}, "FINISH": END},  # 路由映射表：worker 名 → 对应节点，FINISH → 结束
    )
    for name in workers:  # 遍历每个 worker
        builder.add_edge(name, "supervisor")  # worker 执行完固定回到 supervisor，由它决定下一步

    # InMemorySaver + thread_id：支持互动叙事的多轮记忆（进程重启即清空）
    return builder.compile(checkpointer=InMemorySaver())  # 编译图并挂载内存检查点，按 thread_id 恢复会话


__all__ = ["build_graph", "WORKERS", "MAX_STEPS"]  # 声明模块对外暴露的公共接口
