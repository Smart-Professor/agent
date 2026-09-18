"""无 API Key 的冒烟测试：用脚本化假 LLM 验证 LangGraph 结构、主管路由、
产物合并、IMAGE_PROMPT/WORLD_STATE 截取逻辑。

运行：python smoke_test.py
"""

import asyncio
import sys
from unittest.mock import patch

if hasattr(sys.stdout, "reconfigure"):  # Windows 控制台默认 GBK，打不出 emoji
    sys.stdout.reconfigure(encoding="utf-8")

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult


class ScriptedLLM(BaseChatModel):
    """按脚本顺序返回预设文本；with_structured_output 会失败并走 JSON 回退路径。"""

    responses: list
    idx: int = 0

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        text = self.responses[min(self.idx, len(self.responses) - 1)]
        self.idx += 1
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])

    @property
    def _llm_type(self) -> str:
        return "scripted-fake"


def run():
    fake = ScriptedLLM(responses=[
        '{"next": "story", "instruction": "写一个星际港口短篇故事", "reason": "先出故事"}',
        "清晨的星港苏醒了。（假故事文本）",
        '{"next": "character", "instruction": "为主角设计人设", "reason": "故事需要角色"}',
        "凌夜 | 银发少年 | 冷静 | 港口拾荒者出身 | “星海会回答我们。”\nIMAGE_PROMPT: character portrait, silver hair boy, full body",
        '{"next": "interaction", "instruction": "开启互动叙事", "reason": "剧情就绪"}',
        "你站在舷窗前……【A】登舰 【B】留下\nWORLD_STATE: 玩家刚抵达星港，尚未做出选择",
        '{"next": "FINISH", "instruction": "", "reason": "校验一致，完成"}',
    ])

    with patch("app.supervisor.get_llm", return_value=fake), \
         patch("app.workers.get_llm", return_value=fake), \
         patch("app.workers.generate_image", lambda prompt: "https://example.com/fake.png"):
        from app.graph import build_graph
        graph = build_graph()

        state = asyncio.run(graph.ainvoke(
            {"messages": [HumanMessage(content="写个故事带角色和互动")], "user_input": "写个故事带角色和互动", "steps": 0},
            {"configurable": {"thread_id": "smoke"}},
        ))

    # 路由链：supervisor → story → supervisor → character → supervisor → interaction → FINISH
    assert state["next_agent"] == "FINISH", state["next_agent"]
    assert state["steps"] == 4, state["steps"]
    assert "星港" in state["artifacts"]["story"]
    # IMAGE_PROMPT 行已截取并生图
    assert "IMAGE_PROMPT" not in state["artifacts"]["characters"]
    assert state["images"] == [{"agent": "character", "prompt": "character portrait, silver hair boy, full body", "url": "https://example.com/fake.png"}]
    # WORLD_STATE 已截取为世界观状态
    assert "WORLD_STATE" not in state["artifacts"]["interaction"]
    assert state["artifacts"]["world_state"] == "玩家刚抵达星港，尚未做出选择"
    # worker 消息已入对话历史
    names = [m.name for m in state["messages"] if getattr(m, "name", None)]
    assert names == ["supervisor", "story", "supervisor", "character", "supervisor", "interaction", "supervisor"], names
    print("✅ smoke test 通过：路由链 story→character→interaction→FINISH，产物/生图/世界观状态均正确")


if __name__ == "__main__":
    run()
