"""写作 Agent：基于 LangChain 的工具调用 Agent（最基础合格版）。

升级点（相对纯流式调用）：
- 模型可自主决定调用工具（calculator / get_current_time / text_stats）
- 自研 Agent 循环含最大迭代控制，防止死循环（兼容任意 LangChain 版本）
- 保留 write()（一次性）与 write_stream()（流式，仅正文直通）接口，上层无感
"""
from typing import AsyncIterator, List, Literal, Optional

from app.agents.tool_agent import run_agent, trim_history
from app.models.gateway import ModelGateway


class WriterAgent:
    """负责根据 prompt 产出正文内容，具备工具调用能力。"""

    def __init__(self, model: Optional[str] = None):
        self.model = model
        # 保留直连网关：用于流式输出场景（工具调用与流式兼容性差，流式时退化为直连）
        self.gateway = ModelGateway(model=model)

    async def write(
        self,
        prompt: str,
        history: Optional[List[dict]] = None,
        attachments: Optional[List[dict]] = None,
        **kwargs,
    ) -> str:
        """一次性生成完整正文（默认支持工具调用）。history 为 [{role, content}] 列表。

        带图片/音频等多模态附件时绕过工具 Agent 循环（LangChain 消息与内容块不兼容），
        直接走模型网关，与流式路径的降级策略一致。
        """
        if attachments:
            return await self.gateway.generate(prompt, history=history, attachments=attachments, **kwargs)
        # Agent 循环：模型可自主调工具后再作答，历史已在 run_agent 内裁剪
        return await run_agent(prompt, history=history, model=self.model)

    async def write_stream(
        self,
        prompt: str,
        history: Optional[List[dict]] = None,
        attachments: Optional[List[dict]] = None,
        **kwargs,
    ) -> AsyncIterator[tuple[Literal["thinking", "content", "image", "image_status"], str]]:
        """流式生成，逐段 yield (片段类型, 值)（用于 SSE 实时展示）。

        - thinking：思考过程；content：正文；
        - image：模型调用 generate_image 工具后返回的图片 URL；
        - image_status：图片生成中的状态提示。
        多模态附件（图片/音频/文档）在网关中组装为 OpenAI 内容块透传给模型。
        """
        async for kind, chunk in self.gateway.stream_agent(
            prompt, history=history, attachments=attachments, **kwargs
        ):
            yield kind, chunk
