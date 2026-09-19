"""GLM 客户端：智谱开放平台提供 OpenAI 兼容接口，直接用 ChatOpenAI 接入。"""

from functools import lru_cache  # 导入 lru_cache，用于按 temperature 缓存客户端实例

from langchain_openai import ChatOpenAI  # 导入 OpenAI 兼容的对话模型客户端

from .. import config  # 导入全局配置（模型名、API Key、接口地址）


@lru_cache(maxsize=4)  # 按 temperature 参数缓存，避免重复创建客户端
def get_llm(temperature: float = 0.8) -> ChatOpenAI:  # 获取 GLM 对话模型客户端；temperature 越高输出越发散
    return ChatOpenAI(  # 创建 ChatOpenAI 实例（智谱接口与 OpenAI 协议兼容）
        model=config.MODEL,  # 使用配置中的对话模型名
        api_key=config.require_api_key(),  # 校验并传入 API Key（缺失时在此报错）
        base_url=config.BASE_URL,  # 智谱 OpenAI 兼容接口地址
        temperature=temperature,  # 采样温度：主管用 0.2 求稳，worker 用默认值求创意
        streaming=True,  # 开启流式输出，供 SSE 接口逐字推送
    )
