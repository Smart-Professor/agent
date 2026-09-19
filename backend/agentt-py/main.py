"""FastAPI 入口：SSE 流式对话接口 + 静态查看页。

运行：uvicorn main:app --reload
查看：浏览器打开 http://localhost:8000
"""

import json  # 导入 json，用于把 SSE 事件数据序列化为 JSON 字符串
from pathlib import Path  # 导入 Path，用于定位静态文件目录

from fastapi import FastAPI  # 导入 FastAPI 框架主类
from fastapi.middleware.cors import CORSMiddleware  # 导入 CORS 中间件，允许浏览器跨域访问
from fastapi.responses import StreamingResponse  # 导入流式响应，用于 SSE 事件流
from fastapi.staticfiles import StaticFiles  # 导入静态文件服务，托管前端查看页
from langchain_core.messages import HumanMessage  # 导入用户消息类型，作为图的输入
from pydantic import BaseModel  # 导入 BaseModel，定义请求体 schema

from app import config as settings  # 导入全局配置（模型名等，用于健康检查展示）
from app.graph import build_graph  # 导入 LangGraph 图构建入口（lru_cache 单例）
from app.planning.supervisor import WORKERS  # 导入 worker 名单，用于区分节点类型

app = FastAPI(title="AI 创作多智能体（Supervisor 主管模式）")  # 创建 FastAPI 应用实例
app.add_middleware(  # 挂载 CORS 中间件
    CORSMiddleware,  # 中间件类
    allow_origins=["*"],  # 允许任意来源跨域（开发环境从宽）
    allow_methods=["*"],  # 允许所有 HTTP 方法
    allow_headers=["*"],  # 允许所有请求头
)


class ChatRequest(BaseModel):  # 对话请求体 schema
    message: str  # 用户输入的消息
    thread_id: str = "default"  # 会话线程 ID：同一 ID 共享多轮记忆


def sse(event: str, data: dict) -> str:  # 构造一条 SSE 事件文本（event 行 + data 行 + 空行结尾）
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"  # ensure_ascii=False 保持中文原样


@app.get("/health")  # 注册健康检查接口
def health():  # 返回服务状态与当前模型配置
    return {"status": "ok", "model": settings.MODEL, "image_model": settings.IMAGE_MODEL}  # 状态 + 对话模型 + 生图模型


@app.post("/chat/stream")  # 注册 SSE 流式对话接口
async def chat_stream(req: ChatRequest):  # 主管对话接口：接收消息，返回事件流
    """主管对话接口，SSE 事件流：

    start     会话开始 {thread_id}
    route     主管调度 {next, instruction, reason}
    token     worker 逐 token 输出 {node, text}
    node_done worker 完成 {node, images}
    final     全部产物 {artifacts, images}
    error     出错 {message}
    end       结束 {}
    """

    async def gen():  # 异步生成器：逐条产出 SSE 事件
        yield sse("start", {"thread_id": req.thread_id})  # 第一个事件：会话开始
        graph = build_graph()  # 获取编译好的图（单例，进程内复用）
        run_cfg = {"configurable": {"thread_id": req.thread_id}}  # 运行配置：thread_id 决定多轮记忆归属
        # steps 每轮清零：轮数上限只限制单次请求内的调度循环
        inputs = {  # 图的输入状态（每轮请求重新初始化）
            "messages": [HumanMessage(content=req.message)],  # 对话历史追加用户消息
            "user_input": req.message,  # 用户本轮输入
            "steps": 0,  # 调度轮数清零
        }
        try:  # 捕获流式过程中的所有异常，转成 error 事件而不中断连接
            async for mode, payload in graph.astream(inputs, run_cfg, stream_mode=["updates", "messages"]):  # 双模式流式：节点更新 + 消息 token
                if mode == "updates":  # 分支一：节点执行完成后的状态增量
                    for node, update in payload.items():  # 遍历本次更新的节点
                        if not update:  # 空更新直接跳过
                            continue  # 处理下一个节点
                        if node == "supervisor":  # 主管节点：发调度事件
                            yield sse("route", {  # route 事件：主管的路由决策
                                "next": update.get("next_agent"),  # 下一个 worker 名或 FINISH
                                "instruction": update.get("instruction"),  # 给该 worker 的指令
                            })
                        elif node in WORKERS:  # worker 节点：发完成事件
                            yield sse("node_done", {"node": node, "images": update.get("images", [])})  # node_done 事件：节点名 + 生图记录
                elif mode == "messages":  # 分支二：模型逐 token 输出
                    chunk, meta = payload  # payload 是 (消息块, 元数据) 元组
                    node = meta.get("langgraph_node")  # 当前 token 来自哪个节点
                    text = chunk.content if isinstance(chunk.content, str) else ""  # 只处理纯文本块（非字符串置空）
                    if text and node in WORKERS:  # 主管走结构化输出，不流式展示
                        yield sse("token", {"node": node, "text": text})  # token 事件：逐字推送给前端
            snapshot = await graph.aget_state(run_cfg)  # 流结束后取最终状态快照
            yield sse("final", {  # final 事件：全部产物一次性下发
                "artifacts": snapshot.values.get("artifacts", {}),  # 故事/角色/场景/分镜/互动/世界观产物
                "images": snapshot.values.get("images", []),  # 全部生图记录
            })
        except Exception as exc:  # 任何异常都不让连接崩掉
            yield sse("error", {"message": str(exc)})  # error 事件：错误信息
        yield sse("end", {})  # 最后一个事件：流结束

    return StreamingResponse(  # 以 SSE 媒体类型返回流式响应
        gen(),  # 异步生成器作为响应体
        media_type="text/event-stream",  # SSE 标准媒体类型
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},  # 禁用缓存与 nginx 缓冲，保证逐字推送
    )


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")  # 根路径托管 static 目录（html=True 时支持 index.html）
