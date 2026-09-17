"""LangChain 工具调用 Agent（最基础合格版，版本兼容）。

不依赖 langchain.agents 的 AgentExecutor（LangChain 1.0 已移除），
只使用 API 稳定的 langchain_core + langchain_openai，自实现
"模型思考 → 调用工具 → 观察结果 → 再作答" 的 Agent 循环。

核心能力：
- 模型自主决定是否调用工具（function calling）
- 最大迭代次数控制，防止死循环
- 复用 registry.py 的多厂商配置（MiMo / GLM 等任意 OpenAI 兼容端点）
"""
from typing import List, Optional

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_openai import ChatOpenAI

from app.models.registry import resolve_provider
from app.agents.tools import get_tools

# Agent 的系统提示词：告诉模型它有工具、什么时候该用
AGENT_SYSTEM_PROMPT = (
    "你是一名专业的内容创作者和智能助手。"
    "你可以使用提供的工具来更好地完成任务：需要精确计算时用 calculator，"
    "需要当前日期时间时用 get_current_time，需要统计文本时用 text_stats。"
    "能直接回答的问题不必调用工具；调用工具后请基于工具结果组织最终回答。"
)

# 上下文裁剪：历史最多保留的条数（一问一答为两条），防止 token 超限
MAX_HISTORY_MESSAGES = 20
# Agent 循环最大轮数：每轮模型可选择调工具或直接作答
MAX_ITERATIONS = 5


def trim_history(history: Optional[List[dict]], max_messages: int = MAX_HISTORY_MESSAGES) -> List:
    """上下文裁剪：只保留最近 max_messages 条 {role, content}，转成 LangChain 消息。"""
    if not history:
        return []
    messages = []
    for msg in history[-max_messages:]:
        role, content = msg.get("role"), msg.get("content")
        if role == "user" and content:
            messages.append(HumanMessage(content=content))
        elif role == "assistant" and content:
            messages.append(AIMessage(content=content))
    return messages


def build_llm(model: Optional[str] = None) -> ChatOpenAI:
    """按模型 ID 构建聊天模型（复用 registry 的多厂商配置）。"""
    base_url, api_key, _ = resolve_provider(model)
    return ChatOpenAI(
        model=model or "mimo-v2.5",
        api_key=api_key,
        base_url=base_url,
        temperature=1.0,
        streaming=False,
    )


async def run_agent(
    prompt: str,
    history: Optional[List[dict]] = None,
    model: Optional[str] = None,
    max_iterations: int = MAX_ITERATIONS,
) -> str:
    """执行一次完整的 Agent 循环，返回最终回答文本。

    流程：system + 历史 + 用户提问 → 模型回复；
    若模型发起工具调用 → 执行工具、把结果以 ToolMessage 回填 → 继续循环；
    直到模型给出纯文本回答或达到迭代上限。
    """
    llm = build_llm(model).bind_tools(get_tools())
    tools_by_name = {t.name: t for t in get_tools()}

    messages = [SystemMessage(content=AGENT_SYSTEM_PROMPT)]
    messages.extend(trim_history(history))
    messages.append(HumanMessage(content=prompt))

    for _ in range(max_iterations):
        response = await llm.ainvoke(messages)
        messages.append(response)

        # 没有工具调用 → 这就是最终回答
        tool_calls = getattr(response, "tool_calls", None)
        if not tool_calls:
            return response.content or ""

        # 有工具调用：逐个执行并把结果回填
        for call in tool_calls:
            tool = tools_by_name.get(call["name"])
            if tool is None:
                result = f"错误：未知工具 {call['name']}"
            else:
                try:
                    result = str(tool.invoke(call["args"]))
                except Exception as e:
                    result = f"工具执行失败: {e}"
            messages.append(
                ToolMessage(content=result, tool_call_id=call["id"])
            )

    # 达到迭代上限仍未收敛，让模型做一次无工具的总结，避免死循环
    messages.append(
        SystemMessage(content="请基于以上信息直接给出最终回答，不要再调用工具。")
    )
    final = await llm.ainvoke(messages)
    return final.content or ""
