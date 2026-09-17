"""FastAPI 入口：SSE 流式对话接口 + 静态查看页。

运行：uvicorn main:app --reload
查看：浏览器打开 http://localhost:8000
"""

import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from app import config as settings
from app.graph import build_graph
from app.supervisor import WORKERS

app = FastAPI(title="AI 创作多智能体（Supervisor 主管模式）")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    thread_id: str = "default"


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
def health():
    return {"status": "ok", "model": settings.MODEL, "image_model": settings.IMAGE_MODEL}


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """主管对话接口，SSE 事件流：

    start     会话开始 {thread_id}
    route     主管调度 {next, instruction, reason}
    token     worker 逐 token 输出 {node, text}
    node_done worker 完成 {node, images}
    final     全部产物 {artifacts, images}
    error     出错 {message}
    end       结束 {}
    """

    async def gen():
        yield sse("start", {"thread_id": req.thread_id})
        graph = build_graph()
        run_cfg = {"configurable": {"thread_id": req.thread_id}}
        # steps 每轮清零：轮数上限只限制单次请求内的调度循环
        inputs = {
            "messages": [HumanMessage(content=req.message)],
            "user_input": req.message,
            "steps": 0,
        }
        try:
            async for mode, payload in graph.astream(inputs, run_cfg, stream_mode=["updates", "messages"]):
                if mode == "updates":
                    for node, update in payload.items():
                        if not update:
                            continue
                        if node == "supervisor":
                            yield sse("route", {
                                "next": update.get("next_agent"),
                                "instruction": update.get("instruction"),
                            })
                        elif node in WORKERS:
                            yield sse("node_done", {"node": node, "images": update.get("images", [])})
                elif mode == "messages":
                    chunk, meta = payload
                    node = meta.get("langgraph_node")
                    text = chunk.content if isinstance(chunk.content, str) else ""
                    if text and node in WORKERS:  # 主管走结构化输出，不流式展示
                        yield sse("token", {"node": node, "text": text})
            snapshot = await graph.aget_state(run_cfg)
            yield sse("final", {
                "artifacts": snapshot.values.get("artifacts", {}),
                "images": snapshot.values.get("images", []),
            })
        except Exception as exc:
            yield sse("error", {"message": str(exc)})
        yield sse("end", {})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
