"""组装 LangGraph：START → supervisor ⇄ workers → END（Supervisor 主管模式）。"""

from functools import lru_cache

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from .state import AgentState
from .supervisor import MAX_STEPS, WORKERS, route, supervisor_node
from .workers import build_workers


@lru_cache(maxsize=1)
def build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("supervisor", supervisor_node)
    workers = build_workers()
    for name, node in workers.items():
        builder.add_node(name, node)

    builder.add_edge(START, "supervisor")
    builder.add_conditional_edges(
        "supervisor",
        route,
        {**{name: name for name in workers}, "FINISH": END},
    )
    for name in workers:
        builder.add_edge(name, "supervisor")

    # InMemorySaver + thread_id：支持互动叙事的多轮记忆（进程重启即清空）
    return builder.compile(checkpointer=InMemorySaver())


__all__ = ["build_graph", "WORKERS", "MAX_STEPS"]
