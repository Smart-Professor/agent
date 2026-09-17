"""全局配置：从 .env 文件读取环境变量，并拼接派生配置（如 redis_url）。

使用 pydantic-settings 的 BaseSettings，自动完成"环境变量 → 类型化字段"的加载与校验。
其他模块统一 `from app.core.config import settings` 使用单例。
"""
from pydantic_settings import BaseSettings  # 配置基类：自动从环境变量/.env 加载字段
from typing import Optional  # 可选类型标记


class Settings(BaseSettings):
    """所有配置项集中在此；未在 .env 出现的字段使用这里的默认值。"""

    # ---- 服务运行配置 ----
    PYTHON_ENV: str = "development"  # 运行环境：development / production
    HOST: str = "0.0.0.0"            # 监听地址，0.0.0.0 表示允许外部访问
    PORT: int = 8000                 # 监听端口

    # ---- Redis（队列 + 发布订阅）----
    REDIS_HOST: str = "localhost"    # Redis 主机
    REDIS_PORT: int = 6379           # Redis 端口
    REDIS_PASSWORD: Optional[str] = None  # Redis 密码，无密码时为 None

    # ---- PostgreSQL（当前预留，直接读写数据库时使用）----
    DB_HOST: str = "localhost"       # 数据库主机
    DB_PORT: int = 5432              # 数据库端口
    DB_USER: str = "postgres"        # 数据库用户名
    DB_PASSWORD: str = ""            # 数据库密码
    DB_NAME: str = "ai_creator"      # 数据库名

    # ---- 小米 MiMo 大模型（OpenAI 兼容协议）----
    MIMO_API_KEY: str = "sk-cvrs7x0i4jucnrj7mmsabl81bi3ead85c7oglnsz2bwj3swm"                                   # API Key（sk- 按量 / tp- 套餐），从 .env 读取
    MIMO_BASE_URL: str = "https://api.xiaomimimo.com/v1"     # 兼容 OpenAI 的接口地址（只到 /v1，SDK 自动拼 /chat/completions）
    MIMO_MODEL: str = "mimo-v2.5"                            # 默认模型 ID（v2.5 首字延迟约 1s；v2.5-pro 约 6s，仅复杂推理时手动切换）

    # ---- 智谱 GLM 大模型（OpenAI 兼容协议）----
    GMLMODEL_API_KEY: Optional[str] = None      # GLM API Key，从 .env 读取
    GMLMODEL_MODEL: Optional[str] = None        # GLM 模型 ID，如 GLM-5.3-Flash

    # ---- 生图工具（模型 function calling 回调 NestJS 内部接口）----
    # 生图工具由模型自主调用；Python 把 prompt POST 给 NestJS，由后者调图片服务并落 R2
    IMAGE_TOOL_URL: str = "http://localhost:13000/chat/internal/image"
    # Python ↔ NestJS 内部调用的共享密钥（两边 .env 必须一致）
    INTERNAL_TOKEN: str = "dev-internal-token"

    @property
    def redis_url(self) -> str:
        """把主机/端口/密码拼成 redis:// 连接串，供 redis 库与 RQ 使用。"""
        if self.REDIS_PASSWORD:
            # 有密码：redis://:密码@主机:端口
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}"
        # 无密码：redis://主机:端口
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}"

    class Config:
        env_file = ".env"  # 指定从当前工作目录下的 .env 读取变量
        extra = "ignore"   # 忽略 .env 中未定义的多余变量，避免 ValidationError


# 全局唯一配置实例，模块导入时即完成加载
settings = Settings()
