"""Agent 接口的请求/响应数据结构（Pydantic 模型，自动生成文档与校验）。"""
from typing import List, Literal, Optional  # 可选类型 / 历史消息列表

from pydantic import BaseModel, Field  # 数据模型基类 / 字段约束工具


class Attachment(BaseModel):
    """一条消息附件：图片 / 文档 / 音频（URL 指向对象存储，文本类附件附带提取内容）。"""

    type: Literal["image", "file", "audio"]  # 附件类型
    url: str = Field(..., min_length=1)      # 文件访问 URL（R2 等对象存储）
    name: Optional[str] = None               # 原始文件名（展示用）
    mime: Optional[str] = None               # MIME 类型
    size: Optional[int] = None               # 文件大小（字节）
    text: Optional[str] = None               # 服务端已提取的文本内容（文档类附件注入 prompt）


class HistoryMessage(BaseModel):
    """一条历史对话消息：role 为 user / assistant；带附件的历史消息原样透传图片等内容块。"""

    role: str = Field(..., pattern="^(user|assistant)$")
    content: str
    attachments: Optional[List[Attachment]] = None


class GenerateRequest(BaseModel):
    """/agent/generate 与 /agent/stream 的请求体。"""

    prompt: str = Field(..., min_length=1, description="创作需求/提示词")  # 必填且不能为空
    model: Optional[str] = Field(
        None, description="模型 ID，如 mimo-v2-flash / mimo-v2.5-pro；不传用 .env 默认"
    )  # 单次覆盖默认模型，不传则为 None
    max_completion_tokens: int = Field(2048, ge=1, le=8192)  # 输出上限，范围 1~8192
    history: Optional[List[HistoryMessage]] = Field(
        None, description="会话历史消息（时间正序，不含本次 prompt）；不传则单轮对话"
    )  # 供 AI 感知之前聊过的内容
    attachments: Optional[List[Attachment]] = Field(
        None, description="本次消息的附件（图片/文档/音频）；仅多模态模型会消费图片与音频"
    )  # 文档类附件由调用方提取好文本放在 text 字段
    mode: Optional[str] = Field(
        None,
        description="Agent 模式：chat=普通对话（默认）；character_design=角色设计智能体",
    )


class GenerateResponse(BaseModel):
    """/agent/generate 的响应体。"""

    model: str     # 实际使用的模型 ID（回显，便于确认）
    content: str   # 生成的正文内容
