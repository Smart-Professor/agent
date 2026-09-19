"""Supervisor 主管节点：解析需求、路由调度、校验一致性。"""

import json  # 导入 json，用于回退路径解析主管输出的 JSON
import re  # 导入 re，用于从纯文本中抠出 JSON 片段

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage  # 消息类型：系统提示/状态材料/调度记录
from pydantic import BaseModel  # 导入 BaseModel，定义结构化输出 schema

from ..action.llm import get_llm  # 导入 GLM 客户端工厂
from ..action.prompts import SUPERVISOR_PROMPT  # 导入主管系统提示词
from ..memory.state import AgentState  # 导入共享状态类型（仅用于类型标注）

WORKERS = ["story", "character", "scene", "storyboard", "interaction"]  # 可调度的 worker 名单（与提示词保持一致）
MAX_STEPS = 12  # 全局调度轮数上限（防死循环）


class Decision(BaseModel):  # 主管结构化输出的 schema（配合 with_structured_output 使用）
    next: str  # 下一步路由：worker 名或 FINISH
    instruction: str  # 给该 worker 的具体任务指令
    reason: str  # 调度理由 / 一致性校验结论


def _digest(state: AgentState) -> str:  # 把状态压缩成主管能读懂的一段材料
    """把用户输入、产物摘要、worker 简报拼成主管能读懂的材料。"""
    parts = [f"用户需求：{state.get('user_input', '')}"]  # 第一段：用户原始需求
    for key, text in state.get("artifacts", {}).items():  # 遍历已有产物
        parts.append(f"【{key}】{text[:200]}{'…' if len(text) > 200 else ''}")  # 每个产物截前 200 字做摘要，超出加省略号
    for report in state.get("reports", [])[-6:]:  # 取最近 6 条 worker 简报
        parts.append(f"(worker简报) {report[:100]}")  # 每条截前 100 字
    return "\n".join(parts)  # 用换行拼成完整材料文本


def _parse_decision(raw: str) -> Decision:  # 回退解析：从纯文本输出中抠出 JSON
    """回退路径：从纯文本输出里抠 JSON。"""
    match = re.search(r"\{.*\}", raw, re.S)  # 贪婪匹配第一个 {...} 块（re.S 让 . 匹配换行符）
    if not match:  # 找不到 JSON 就无法继续调度
        raise ValueError(f"主管输出中没有 JSON：{raw[:200]}")  # 抛错并附上原始输出前 200 字便于排查
    return Decision(**json.loads(match.group()))  # 解析 JSON 并构造 Decision 对象


def supervisor_node(state: AgentState) -> dict:  # 主管节点：决策本轮调度谁、做什么
    messages = [  # 组装发给模型的对话
        SystemMessage(content=SUPERVISOR_PROMPT),  # 系统提示词：调度规则与 JSON 输出格式
        HumanMessage(content=_digest(state)),  # 用户消息：压缩后的当前状态材料
    ]
    llm = get_llm(temperature=0.2)  # 低温度求稳定：调度决策需要确定性
    try:  # 优先走结构化输出
        decision = llm.with_structured_output(Decision).invoke(messages)  # 让模型直接返回 Decision 对象
    except Exception:  # 模型不支持 function calling 时回退到 JSON 文本解析
        decision = _parse_decision(llm.invoke(messages).content)  # 普通调用 + 手工抠 JSON

    if decision.next not in WORKERS and decision.next != "FINISH":  # 路由值合法性校验
        decision = Decision(next="FINISH", instruction="", reason=f"非法路由值 {decision.next!r}，强制结束")  # 非法值强制结束，防止跑飞

    return {  # 返回状态增量：LangGraph 合入全局状态
        "next_agent": decision.next,  # 路由结果：worker 名或 FINISH
        "instruction": decision.instruction if decision.next != "FINISH" else "",  # FINISH 时清空指令
        "steps": state.get("steps", 0) + 1,  # 调度轮数 +1
        "messages": [AIMessage(content=f"[调度] {decision.next}：{decision.reason}", name="supervisor")],  # 对话历史记录本次调度
    }


def route(state: AgentState) -> str:  # 条件路由函数：graph.py 的条件边用它决定下一个节点
    """条件路由：worker 名或 END。超出步数上限强制结束。"""
    if state.get("steps", 0) > MAX_STEPS:  # 超出步数上限
        return "__end__"  # 强制结束，防止死循环
    return state.get("next_agent", "FINISH")  # 否则按主管决策路由（FINISH 会被映射到 END）
