"""无 API Key 的冒烟测试：用脚本化假 LLM 验证 LangGraph 结构、主管路由、
产物合并、IMAGE_PROMPT/WORLD_STATE 截取逻辑。

运行：python smoke_test.py
"""

import asyncio  # 导入 asyncio，用 asyncio.run 驱动异步图调用
import sys  # 导入 sys，用于设置标准输出编码
from unittest.mock import patch  # 导入 patch，运行期替换真实 LLM 与生图函数

if hasattr(sys.stdout, "reconfigure"):  # Windows 控制台默认 GBK，打不出 emoji
    sys.stdout.reconfigure(encoding="utf-8")  # 强制标准输出使用 UTF-8

from langchain_core.language_models import BaseChatModel  # 导入对话模型基类，脚本假模型继承它
from langchain_core.messages import AIMessage, HumanMessage  # 导入消息类型：AI 回复 / 用户输入
from langchain_core.outputs import ChatGeneration, ChatResult  # 导入生成结果类型，封装 _generate 的返回


class ScriptedLLM(BaseChatModel):  # 脚本化假 LLM：按顺序返回预设文本
    """按脚本顺序返回预设文本；with_structured_output 会失败并走 JSON 回退路径。"""

    responses: list  # 预设回复脚本（按调用顺序依次消费）
    idx: int = 0  # 当前消费到的脚本下标

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):  # 基类要求的同步生成方法
        text = self.responses[min(self.idx, len(self.responses) - 1)]  # 取当前脚本项；越界时重复最后一项
        self.idx += 1  # 下标前进一步
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])  # 封装成 AI 消息返回

    @property  # 基类要求的只读属性
    def _llm_type(self) -> str:  # 标识模型类型的属性
        return "scripted-fake"  # 自定义类型名


def run():  # 冒烟测试主流程
    fake = ScriptedLLM(responses=[  # 编排一轮完整调度的脚本回复（主管与 worker 共用同一假模型）
        '{"next": "story", "instruction": "写一个星际港口短篇故事", "reason": "先出故事"}',  # 主管第 1 次决策：调度 story
        "清晨的星港苏醒了。（假故事文本）",  # story worker 的产出
        '{"next": "character", "instruction": "为主角设计人设", "reason": "故事需要角色"}',  # 主管第 2 次决策：调度 character
        "凌夜 | 银发少年 | 冷静 | 港口拾荒者出身 | “星海会回答我们。”\nIMAGE_PROMPT: character portrait, silver hair boy, full body",  # character 产出（末行含生图提示词）
        '{"next": "interaction", "instruction": "开启互动叙事", "reason": "剧情就绪"}',  # 主管第 3 次决策：调度 interaction
        "你站在舷窗前……【A】登舰 【B】留下\nWORLD_STATE: 玩家刚抵达星港，尚未做出选择",  # interaction 产出（末行含世界观状态）
        '{"next": "FINISH", "instruction": "", "reason": "校验一致，完成"}',  # 主管第 4 次决策：结束
    ])

    # 下面三行 patch：把主管/worker 的 LLM 与生图函数替换为假实现（反斜杠续行，注释只能写在上方）
    with patch("app.planning.supervisor.get_llm", return_value=fake), \
         patch("app.action.workers.get_llm", return_value=fake), \
         patch("app.action.workers.generate_image", lambda prompt: "https://example.com/fake.png"):
        from app.graph import build_graph  # 在 patch 生效后再导入图，保证节点内拿到假 LLM
        graph = build_graph()  # 构建图（lru_cache 单例，进程内只编译一次）

        state = asyncio.run(graph.ainvoke(  # 同步驱动异步图调用，跑完整轮调度
            {"messages": [HumanMessage(content="写个故事带角色和互动")], "user_input": "写个故事带角色和互动", "steps": 0},  # 初始状态：用户消息 + 轮数清零
            {"configurable": {"thread_id": "smoke"}},  # 运行配置：固定 thread_id
        ))

    # 路由链：supervisor → story → supervisor → character → supervisor → interaction → FINISH
    assert state["next_agent"] == "FINISH", state["next_agent"]  # 断言 1：最终路由结果为 FINISH
    assert state["steps"] == 4, state["steps"]  # 断言 2：主管共调度 4 轮（story/character/interaction/FINISH）
    assert "星港" in state["artifacts"]["story"]  # 断言 3：故事产物已写入 artifacts
    # IMAGE_PROMPT 行已截取并生图
    assert "IMAGE_PROMPT" not in state["artifacts"]["characters"]  # 断言 4：生图提示词行已从正文移除
    assert state["images"] == [{"agent": "character", "prompt": "character portrait, silver hair boy, full body", "url": "https://example.com/fake.png"}]  # 断言 5：生图记录正确（agent/提示词/假 URL）
    # WORLD_STATE 已截取为世界观状态
    assert "WORLD_STATE" not in state["artifacts"]["interaction"]  # 断言 6：世界观行已从正文移除
    assert state["artifacts"]["world_state"] == "玩家刚抵达星港，尚未做出选择"  # 断言 7：世界观状态已正确提取入库
    # worker 消息已入对话历史
    names = [m.name for m in state["messages"] if getattr(m, "name", None)]  # 按顺序收集带名字的消息
    assert names == ["supervisor", "story", "supervisor", "character", "supervisor", "interaction", "supervisor"], names  # 断言 8：消息顺序符合调度链
    print("✅ smoke test 通过：路由链 story→character→interaction→FINISH，产物/生图/世界观状态均正确")  # 全部断言通过后的提示


if __name__ == "__main__":  # 直接运行本文件时
    run()  # 执行冒烟测试
