"""全局配置：从项目根目录的 .env 读取。"""

import os  # 导入标准库 os，用于读取环境变量

from dotenv import load_dotenv  # 导入 dotenv，用于加载 .env 配置文件

load_dotenv()  # 加载项目根目录的 .env 文件，把键值对写入进程环境变量

API_KEY = os.getenv("ZHIPUAI_API_KEY", "").strip()  # 智谱 API Key，未配置时为空串；strip 去除首尾空白
BASE_URL = os.getenv("GLM_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/")  # GLM 开放平台接口地址，默认官方 v4 地址
MODEL = os.getenv("GLM_MODEL", "glm-5.3-flash")  # 对话模型名，默认 glm-5.3-flash
IMAGE_MODEL = os.getenv("GLM_IMAGE_MODEL", "cogview-3-flash")  # 文生图模型名，默认 cogview-3-flash


def require_api_key() -> str:  # 校验并返回 API Key；Key 缺失时立即报错，避免请求期才失败
    if not API_KEY:  # 未配置 Key 时
        raise RuntimeError(  # 抛出运行时异常，提前暴露配置问题
            "未配置 API Key：请复制 .env.example 为 .env，填入 ZHIPUAI_API_KEY 后重启服务"  # 面向使用者的配置指引
        )
    return API_KEY  # 校验通过，返回 API Key
