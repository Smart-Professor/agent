"""Redis 客户端单例：供队列（RQ）和发布订阅（任务状态/流式推送）使用。"""
import redis  # redis-py 客户端库
from app.core.config import settings  # 全局配置

# 模块加载时创建唯一的 Redis 连接实例（惰性连接，首次命令才真正建连）
redis_client = redis.Redis.from_url(
    settings.redis_url,   # 连接串 redis://[:密码@]主机:端口
    decode_responses=True,  # True：读写自动按 UTF-8 解码为 str，否则返回 bytes
)


def get_redis() -> redis.Redis:
    """获取全局 Redis 客户端（依赖注入风格，便于各处复用同一连接）。"""
    return redis_client
