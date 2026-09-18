"""全局配置：从项目根目录的 .env 读取。"""

import os

from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("ZHIPUAI_API_KEY", "").strip()
BASE_URL = os.getenv("GLM_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/")
MODEL = os.getenv("GLM_MODEL", "glm-5.3-flash")
IMAGE_MODEL = os.getenv("GLM_IMAGE_MODEL", "cogview-3-flash")


def require_api_key() -> str:
    if not API_KEY:
        raise RuntimeError(
            "未配置 API Key：请复制 .env.example 为 .env，填入 ZHIPUAI_API_KEY 后重启服务"
        )
    return API_KEY
