"""创作任务的队列消费逻辑：被 RQ worker 调用，流式生成内容并回写 Redis。

数据流：RQ 取出任务 → MiMo 流式生成 → 逐段 publish 到 task:{id}:stream
        → 完成后把状态/结果写入 Redis，供 NestJS 侧读取与 SSE 转发。
"""
import asyncio  # worker 是同步环境，用 asyncio.run 驱动异步生成
import json     # 把进度/结果字典序列化为 JSON 字符串存入 Redis

from app.agents.writer import WriterAgent  # 写作 Agent
from app.core.redis_client import get_redis  # Redis 客户端


async def _run_creation(task_data: dict):
    """实际创作流程（异步）：调用 MiMo 流式生成，并把每段推送到 Redis 频道。"""
    task_id = task_data.get("task_id")            # 任务唯一标识
    prompt = task_data.get("prompt", "")          # 用户创作需求
    params = task_data.get("params") or {}        # 附加参数（如指定模型）
    redis_client = get_redis()

    # params.model 可指定模型，缺省为 None → 用 .env 默认模型
    writer = WriterAgent(model=params.get("model"))
    content_parts = []  # 收集每个分片，最终拼接为完整正文
    received = 0        # 已收到的分片数，用于估算进度

    async for kind, chunk in writer.write_stream(prompt):
        # thinking 为模型思考过程，仅用于驱动进度，不计入最终正文
        if kind != "content":
            received += 1
            continue
        content_parts.append(chunk)
        received += 1
        # 进度按流式块数粗略估算（封顶 95%），任务真正完成时再置 100%
        progress = min(95, 10 + received * 2)
        # 发布到该任务专属频道，NestJS 订阅后可经 SSE 转发给前端
        redis_client.publish(
            f"task:{task_id}:stream",
            json.dumps(
                {
                    "task_id": task_id,
                    "chunk": chunk,       # 本次生成的正文片段
                    "progress": progress, # 当前进度百分比
                },
                ensure_ascii=False,       # 中文不转义为 \uXXXX
            ),
        )

    # 拼接所有分片得到完整正文
    content = "".join(content_parts)
    # 写入最终状态与结果（key 约定：task:{id}:status / :result）
    redis_client.set(f"task:{task_id}:status", "completed")
    redis_client.set(
        f"task:{task_id}:result",
        json.dumps({"content": content}, ensure_ascii=False),
    )
    return content


def process_task(task_data: dict):
    """
    消费队列任务的核心函数，被 RQ worker 调用（同步入口）。

    task_data 示例:
    {
        "task_id": "abc123",
        "type": "story",
        "prompt": "写一个科幻故事",
        "params": {"model": "mimo-v2-flash"}
    }
    """
    task_id = task_data.get("task_id")
    redis_client = get_redis()

    # 标记任务进入处理中
    redis_client.set(f"task:{task_id}:status", "processing")

    try:
        # RQ worker 是同步进程，这里为异步创作流程新建事件循环并运行到结束
        asyncio.run(_run_creation(task_data))
        return {"status": "completed", "task_id": task_id}
    except Exception as e:
        # 失败时记录状态与错误信息，便于上层查询与展示
        redis_client.set(f"task:{task_id}:status", "failed")
        redis_client.set(f"task:{task_id}:error", str(e))
        # 重新抛出，让 RQ 把该作业标记为 failed
        raise e
