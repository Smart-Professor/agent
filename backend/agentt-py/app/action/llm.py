"""GLM 客户端：智谱开放平台提供 OpenAI 兼容接口，直接用 ChatOpenAI 接入。"""

from functools import lru_cache

from langchain_openai import ChatOpenAI

from .. import config


@lru_cache(maxsize=4)
def get_llm(temperature: float = 0.8) -> ChatOpenAI:
    return ChatOpenAI(
        model=config.MODEL,
        api_key=config.require_api_key(),
        base_url=config.BASE_URL,
        temperature=temperature,
        streaming=True,
    )
