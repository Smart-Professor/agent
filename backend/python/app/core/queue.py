"""RQ 任务队列封装：把创作任务投递到 Redis 队列，由独立的 rq worker 进程消费。"""
from rq import Queue  # RQ（Redis Queue）队列类
from app.core.redis_client import get_redis  # 获取 Redis 连接
import json  # noqa: F401  预留给任务消息序列化（当前 RQ 内部用 pickle 序列化）

# 任务队列名称；worker 启动时必须监听同名队列：rq worker creation_tasks
QUEUE_NAME = "creation_tasks"


def get_queue() -> Queue:
    """获取绑定在 Redis 上的队列实例。"""
    return Queue(QUEUE_NAME, connection=get_redis())


def enqueue_task(task_data: dict):
    """将任务投递到队列。

    Args:
        task_data: 任务字典，需包含 task_id / type / prompt / params。

    Returns:
        新创建的 RQ 作业 ID（job.id），可用于查询任务状态。
    """
    q = get_queue()
    # 用字符串指定消费函数路径，worker 进程会按路径导入并执行
    job = q.enqueue(
        "app.services.creation.process_task",  # 消费函数的完整导入路径
        task_data,                             # 传给该函数的唯一位置参数
        job_timeout=300,                       # 单次执行超时时间（秒），超时判失败
    )
    return job.id
