"""LangGraph 共享状态：所有 Agent 通过它传递素材与产物。"""

import operator
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph import add_messages


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]  # 完整对话历史
    user_input: str  # 用户本轮输入
    instruction: str  # 主管给当前 worker 的指令
    next_agent: str  # 主管路由结果：worker 名或 FINISH
    artifacts: dict[str, str]  # 产物：story/characters/scenes/storyboard/interaction/world_state
    reports: Annotated[list[str], operator.add]  # worker 给主管的简报
    images: Annotated[list[dict], operator.add]  # 生图记录 {agent, prompt, url, error?}
    steps: int  # 调度轮数（防死循环）

