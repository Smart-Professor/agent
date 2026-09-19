"""文生图工具：当前接入智谱 CogView（与 GLM 共用同一个 API Key）。

以后要换 SDXL / 3DGS 等自建服务，只需替换 generate_image 的实现，
签名保持 (prompt: str) -> url: str 不变，其余代码不用动。
"""

import openai  # 导入 openai SDK（智谱接口与 OpenAI 协议兼容，直接复用）

from .. import config  # 导入全局配置（API Key、接口地址、生图模型名）


def generate_image(prompt: str) -> str:  # 文生图入口：签名保持稳定，便于以后替换底层实现
    """文生图：输入提示词，返回图片 URL。失败时抛异常，由调用方兜底。"""
    client = openai.OpenAI(api_key=config.API_KEY, base_url=config.BASE_URL)  # 创建 OpenAI 兼容客户端，指向智谱平台
    resp = client.images.generate(model=config.IMAGE_MODEL, prompt=prompt)  # 调用文生图接口（CogView 模型）
    return resp.data[0].url  # 返回生成图片的 URL（失败时异常向上抛，由 worker 记录 error）
