"""Supervisor 主管节点：解析需求、路由调度、校验一致性。"""

import json
import re

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from .llm import get_llm
from .prompts import SUPERVISOR_PROMPT
from .state import AgentState

WORKERS = ["story", "character", "scene", "storyboard", "interaction"]
MAX_STEPS = 12  # 全局调度轮数上限（防死循环）


class Decision(BaseModel):
    next: str
    instruction: str
    reason: str


def _digest(state: AgentState) -> str:
    """把用户输入、产物摘要、worker 简报拼成主管能读懂的材料。"""
    parts = [f"用户需求：{state.get('user_input', '')}"]
    for key, text in state.get("artifacts", {}).items():
        parts.append(f"【{key}】{text[:200]}{'…' if len(text) > 200 else ''}")
    for report in state.get("reports", [])[-6:]:
        parts.append(f"(worker简报) {report[:100]}")
    return "\n".join(parts)


def _parse_decision(raw: str) -> Decision:
    """回退路径：从纯文本输出里抠 JSON。"""
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        raise ValueError(f"主管输出中没有 JSON：{raw[:200]}")
    return Decision(**json.loads(match.group()))


def supervisor_node(state: AgentState) -> dict:
    messages = [
        SystemMessage(content=SUPERVISOR_PROMPT),
        HumanMessage(content=_digest(state)),
    ]
    llm = get_llm(temperature=0.2)
    try:
        decision = llm.with_structured_output(Decision).invoke(messages)
    except Exception:  # 模型不支持 function calling 时回退到 JSON 文本解析
        decision = _parse_decision(llm.invoke(messages).content)

    if decision.next not in WORKERS and decision.next != "FINISH":
        decision = Decision(next="FINISH", instruction="", reason=f"非法路由值 {decision.next!r}，强制结束")

    return {
        "next_agent": decision.next,
        "instruction": decision.instruction if decision.next != "FINISH" else "",
        "steps": state.get("steps", 0) + 1,
        "messages": [AIMessage(content=f"[调度] {decision.next}：{decision.reason}", name="supervisor")],
    }


def route(state: AgentState) -> str:
    """条件路由：worker 名或 END。超出步数上限强制结束。"""
    if state.get("steps", 0) > MAX_STEPS:
        return "__end__"
    return state.get("next_agent", "FINISH")
