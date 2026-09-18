"""FastAPI 应用入口：AI Creator Agent（对接小米 MiMo 大模型）

职责：
1. 创建 FastAPI 应用并配置 CORS；
2. 提供健康检查接口；
3. 提供 MiMo 的一次性生成（/agent/generate）与流式生成（/agent/stream）两个接口。
"""

import json  # 用于把流式分片字典序列化为 SSE 文本
import re  # 角色设计模式：从正文中提取"绘图提示词"段自动生成立绘

from fastapi import FastAPI, HTTPException  # FastAPI 应用类、HTTP 异常类
from fastapi.middleware.cors import CORSMiddleware  # 跨域中间件，允许前端浏览器跨端口访问
from fastapi.responses import StreamingResponse  # 流式响应，用于 SSE 逐段推送生成内容

from app.agents.character_designer import CharacterDesignerAgent  # 角色设计 Agent
from app.agents.writer import WriterAgent  # 写作 Agent，封装了对 MiMo 的调用
from app.core.config import settings  # 全局配置（读取 .env：端口、模型名等）
from app.models.gateway import ModelGateway  # 模型网关，提供 is_configured() 判断 Key 是否已配置
from app.models.registry import list_models  # 模型注册表：列出全部模型及其多模态能力
from app.schemas.Data_type import GenerateRequest, GenerateResponse  # 请求体 / 响应体的数据结构

# 创建 FastAPI 应用实例，title/version 会显示在 /docs 文档页
app = FastAPI(title="AI Creator Agent", version="1.0.0")

# 注册 CORS 中间件：前端（15173）和 NestJS（13000）跨端口调用本服务时不被浏览器拦截
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:15173", "http://localhost:13000"],  # 允许的来源：Vue 前端、NestJS 后端
    allow_credentials=True,   # 允许携带 Cookie 等凭证
    allow_methods=["*"],      # 允许所有 HTTP 方法（GET/POST/...）
    allow_headers=["*"],      # 允许所有请求头
)


@app.get("/")
async def root():
    """根路径：快速确认服务存活，以及当前配置使用的模型"""
    return {"status": "ok", "service": "ai-creator-agent", "model": settings.MIMO_MODEL}


@app.get("/health")
async def health():
    """健康检查：供监控/部署探活；model_configured 表示 MiMo API Key 是否可用"""
    return {"status": "healthy", "model_configured": ModelGateway.is_configured()}


@app.get("/agent/models")
async def agent_models():
    """模型清单（含多模态能力声明）：前端据此决定附件/图片理解功能是否可用。

    能力字段：vision=图片理解、audio=语音理解；均为 false 的模型按纯文本处理。
    """
    return {"models": list_models(), "default": settings.MIMO_MODEL}


@app.post("/agent/generate", response_model=GenerateResponse)
async def agent_generate(req: GenerateRequest):
    """直接调用小米 MiMo 生成内容（不依赖 Redis，可在 /docs 直接测试）"""
    # Key 未配置时提前拦截，返回 503 而不是让调用抛出裸异常
    if not ModelGateway.is_configured():
        raise HTTPException(
            status_code=503,
            detail="未配置 MIMO_API_KEY，请先填写 backend/python/.env",
        )
    try:
        # 角色设计模式走专用 Agent（固定人设提示词 + 固定输出结构）；其余为普通对话
        writer = (
            CharacterDesignerAgent(model=req.model)
            if req.mode == "character_design"
            else WriterAgent(model=req.model)  # req.model 为 None 时使用 .env 中的默认模型
        )
        # 一次性等待完整结果；max_completion_tokens 由请求体控制（思考模型需给足额度）
        content = await writer.write(
            req.prompt,
            max_completion_tokens=req.max_completion_tokens,
            history=[h.model_dump() for h in req.history] if req.history else None,
            attachments=req.attachments,
        )
    except Exception as e:
        # 上游（MiMo 接口）调用失败统一包装为 502，错误信息透传给调用方便于排查
        raise HTTPException(status_code=502, detail=f"MiMo 调用失败: {e}")

    # 返回实际使用的模型名与生成正文
    return GenerateResponse(model=writer.gateway.model, content=content)


@app.post("/agent/stream")
async def agent_stream(req: GenerateRequest):
    """SSE 流式调用 MiMo，逐段返回（data: {"chunk": "..."}）"""
    # 与 /agent/generate 相同的配置检查
    if not ModelGateway.is_configured():
        raise HTTPException(
            status_code=503,
            detail="未配置 MIMO_API_KEY，请先填写 backend/python/.env",
        )

    async def event_generator():
        """SSE 事件生成器：模型每产出一段就 yield 一条 data 消息"""
        writer = (
            CharacterDesignerAgent(model=req.model)
            if req.mode == "character_design"
            else WriterAgent(model=req.model)
        )
        full_text = ""  # 正文累积（角色设计模式用于提取绘图提示词自动出图）
        try:
            # 异步迭代流式输出：thinking 为思考过程（供前端即时展示），content 为正文
            async for kind, chunk in writer.write_stream(
                req.prompt,
                max_completion_tokens=req.max_completion_tokens,
                # 历史消息让模型感知之前的对话内容（多轮上下文）
                history=[h.model_dump() for h in req.history] if req.history else None,
                # 本次消息的多模态附件（图片/文档/音频），由网关组装为内容块
                attachments=req.attachments,
            ):
                if kind == "content":
                    full_text += chunk
                # 片段类型 → SSE 事件字段：thinking=思考 / chunk=正文 / image=工具生图 URL
                if kind == "thinking":
                    event = {"thinking": chunk}
                elif kind == "image":
                    event = {"image": chunk}
                elif kind == "image_status":
                    event = {"image_status": chunk}
                else:
                    event = {"chunk": chunk}
                # SSE 协议格式：data: <文本>\n\n；ensure_ascii=False 保证中文不被转义
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

            # 角色设计模式：正文完成后自动按视觉方案生成一张角色立绘（复用生图工具，落 R2）
            if req.mode == "character_design" and writer.gateway.is_configured():
                try:
                    yield f"data: {json.dumps({'image_status': '正在根据视觉方案生成角色立绘…'}, ensure_ascii=False)}\n\n"
                    # 优先取方案里"绘图提示词"一段（更精准）；取不到就用原始需求兜底
                    m = re.search(r"绘图提示词[^\n]*[：:]\s*([\s\S]+)$", full_text)
                    image_prompt = m.group(1).strip()[:900] if m else req.prompt[:900]
                    img_url = await writer.gateway._execute_image_tool(image_prompt)
                    yield f"data: {json.dumps({'image': img_url}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    # 立绘失败不影响正文方案，仅提示
                    yield f"data: {json.dumps({'image_status': f'立绘生成失败：{e}'}, ensure_ascii=False)}\n\n"

            # 约定的结束标记，前端 EventSource 收到后结束本轮读取
            yield "data: [DONE]\n\n"
        except Exception as e:
            # 流式开始后无法再改 HTTP 状态码，错误也以 SSE data 形式下发
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    # 以 text/event-stream 返回；两个响应头禁用缓冲，确保分片即时到达浏览器
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    # 仅在直接执行 `python app/main.py` 时走这里；用 uvicorn 命令启动时不触发
    import uvicorn  # ASGI 服务器

    uvicorn.run(
        "app.main:app",        # 应用的导入路径（字符串形式支持热重载）
        host=settings.HOST,    # 监听地址，.env 中为 0.0.0.0（允许外部访问）
        port=settings.PORT,    # 监听端口，config.py 默认 18000（根 .env 不放 PORT）
        reload=True,           # 代码变更后自动重启，仅适合开发环境
    )
