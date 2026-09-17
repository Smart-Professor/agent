"""任务数据结构：定义队列中流转的创作任务字段。"""
from typing import Any, Dict, Optional  # 任意类型 / 字典 / 可选类型
from pydantic import BaseModel         # 数据模型基类


class TaskData(BaseModel):
    """NestJS 投递到 Redis 队列的创作任务结构。"""

    task_id: str                        # 任务唯一 ID（用于状态查询与频道命名）
    type: str                           # 创作类型，如 story / article / copywriting
    prompt: str                         # 用户的创作需求
    params: Optional[Dict[str, Any]] = None  # 附加参数（模型、风格等），可为空
