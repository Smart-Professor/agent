"""模型提供商适配：小米 MiMo（OpenAI 兼容协议）

官方文档：https://mimo.mi.com/docs/zh-CN/quick-start/first-api-call
- BASE_URL（按量付费）：https://api.xiaomimimo.com/v1
- 鉴权：Authorization: Bearer sk-xxxxx
- 模型：mimo-v2-flash / mimo-v2.5-pro / mimo-7b-instruct

因为协议与 OpenAI 完全一致，这里直接复用官方 openai SDK，只改 base_url 与鉴权。
"""
from typing import Optional  # 可选类型标记

from openai import AsyncOpenAI, OpenAI  # OpenAI 官方 SDK，MiMo 兼容，可直接用

from app.core.config import settings  # 全局配置

# MiMo 官方推荐的系统提示词（定义助手身份）
MIMO_SYSTEM_PROMPT = (
    "你是一个专业的助手，你的任务是回答用户的问题。"
)


def get_mimo_kwargs() -> dict:
    """OpenAI SDK 连接 MiMo 所需参数（鉴权 Key + 接口地址）。"""
    return {
        "api_key": settings.MIMO_API_KEY,    # 从 .env 读取的 MiMo Key
        "base_url": settings.MIMO_BASE_URL,  # MiMo 的 OpenAI 兼容端点
    }


def get_mimo_client() -> OpenAI:
    """同步客户端（在 RQ worker 这类同步环境中使用）。"""
    return OpenAI(**get_mimo_kwargs())


# 异步客户端单例：复用底层 httpx 连接池（keep-alive），
# 避免每次对话都重新与 MiMo 接口做 TCP + TLS 握手（可省数百毫秒）
_async_client: Optional[AsyncOpenAI] = None


def get_mimo_async_client() -> AsyncOpenAI:
    """异步客户端（在 FastAPI 异步接口与流式生成中使用），全局单例。"""
    global _async_client
    if _async_client is None:
        _async_client = AsyncOpenAI(**get_mimo_kwargs())
    return _async_client
