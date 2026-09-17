"""编审 Agent（待实现）：负责审校 Writer 的产出。

当前为占位骨架，后续通过 ModelGateway 实现真实审校。
"""


class ReviewerAgent:
    """负责审校写作结果，给出修改建议或修订稿。"""

    async def review(self, content: str, **kwargs) -> str:
        """审校入口：传入正文，返回修改建议或修订后的文本。

        TODO: 构造审校提示词，通过 ModelGateway 调用大模型完成审校。
        """
        # TODO: 通过 ModelGateway 审校内容
        raise NotImplementedError("ReviewerAgent.review 尚未实现")
