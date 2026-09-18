"""文生图工具：当前接入智谱 CogView（与 GLM 共用同一个 API Key）。

以后要换 SDXL / 3DGS 等自建服务，只需替换 generate_image 的实现，
签名保持 (prompt: str) -> url: str 不变，其余代码不用动。
"""

import openai

from .. import config


def generate_image(prompt: str) -> str:
    """文生图：输入提示词，返回图片 URL。失败时抛异常，由调用方兜底。"""
    client = openai.OpenAI(api_key=config.API_KEY, base_url=config.BASE_URL)
    resp = client.images.generate(model=config.IMAGE_MODEL, prompt=prompt)
    return resp.data[0].url
