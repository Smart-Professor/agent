"""模型网关：对上层提供统一的"一次性生成 / 流式生成"入口，当前对接小米 MiMo。

后续若要接入其他 OpenAI 兼容厂商，只需在此扩展，不必改动各 Agent。
"""
import base64  # 音频附件转 base64 供 input_audio 内容块使用
import json    # 解析工具调用参数 / 序列化工具返回

import httpx  # 异步下载音频附件字节 / 回调 NestJS 内部生图接口
from typing import Any, AsyncIterator, Dict, List, Literal, Optional  # 异步迭代器 / 列表 / 字面量类型 / 可选类型

from openai import AsyncOpenAI                          # OpenAI 兼容异步客户端（各厂商通用）
from app.core.config import settings                    # 全局配置
from app.models.providers import MIMO_SYSTEM_PROMPT     # 默认系统提示词
from app.models.registry import resolve_provider        # 按模型 ID 解析提供商连接参数

# 视为"未配置"的 Key 集合：空值或占位符都拦截，避免拿假 Key 去请求
_PLACEHOLDER_KEYS = {"", "sk-your_mimo_key", "sk-your_openai_key"}

# 音频附件大小上限：转成 base64 后会膨胀 ~1.33 倍，控制在 20MB 原文件以内
_AUDIO_MAX_BYTES = 20 * 1024 * 1024

# 生图工具的 function-calling 描述（模型据此自主判断何时该画图，无需用户切换模式）
GENERATE_IMAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_image",
        "description": (
            "根据文本描述生成一张图片。当用户要求画画、画图、生成/制作/出一张图片、"
            "设计配图、生成头像/海报等明确的图像创作需求时调用此工具；"
            "纯文字问答、图片理解、闲聊不要调用。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "画面内容的详细描述（主体、场景、风格、构图、光影等），越具体越好",
                }
            },
            "required": ["prompt"],
        },
    },
}

# 改图工具：基于用户上传的已有图片进行编辑（gpt-image edits 端点）
EDIT_IMAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "edit_image",
        "description": (
            "基于用户消息中已有的一张图片进行修改/编辑（改风格、改元素、换背景、"
            "局部调整、加字等）。仅当用户上传了图片并明确要求在其基础上修改时调用；"
            "image_url 必须使用该图片附件消息里的原始 URL。从零生成新图片请改用 generate_image。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "修改要求的具体描述：改什么、改成什么样",
                },
                "image_url": {
                    "type": "string",
                    "description": "要编辑的图片 URL（用户消息中图片附件的 URL）",
                },
            },
            "required": ["prompt", "image_url"],
        },
    },
}

# 追加到系统提示词：告诉模型它具备生图/改图工具及使用边界
_TOOL_SYSTEM_SUFFIX = (
    "你有两个图像工具：用户要求凭空生成/画一张图时调用 generate_image；"
    "用户上传了图片并要求在其基础上修改时调用 edit_image（image_url 用消息中图片附件的 URL）。"
    "调用前把用户的画面意图整理成具体 prompt；工具执行期间可用一句话告诉用户正在创作。"
    "普通问答、看图说话（不改动图片）不要调用工具。"
)

# 部分模型在工具调用后的那一轮，会把思考过程以"字面文本"形式写进正文 content
# （开标签 <antThinking>，闭标签有时是不配对的 </think>）。需要从正文开头剥掉这一段。
_THINK_OPEN = "<antThinking>"
_THINK_CLOSES = ("</antThinking>", "</think>")
# 模糊匹配期/思考内容期的缓冲上限，防止标签永不到来时无限缓存
_THINK_WATCH_MAX = 256
_THINK_BLOCK_MAX = 32000


class ModelGateway:
    """所有 Agent 通过本网关调用大模型，屏蔽底层厂商差异。

    支持任意 OpenAI 兼容厂商：模型与连接参数在 app/models/registry.py 注册即可。
    多模态：图片以 image_url 内容块透传；音频下载后转 base64 以 input_audio 块透传；
    文档附件由调用方提取好文本（attachment.text），本网关拼入内容块。
    """

    def __init__(self, model: Optional[str] = None):
        # 未显式传模型名时使用 .env 中的默认模型
        self.model = model or settings.MIMO_MODEL
        # 按模型 ID 解析提供商（base_url / api_key），并持有对应异步客户端
        self._base_url, self._api_key, self._api_key_env = resolve_provider(self.model)
        self._client = AsyncOpenAI(api_key=self._api_key, base_url=self._base_url)

    @staticmethod
    def is_configured() -> bool:
        """判断默认模型（MiMo）的 API Key 是否已真实配置（供接口启动前检查）。"""
        return settings.MIMO_API_KEY not in _PLACEHOLDER_KEYS

    def ensure_ready(self) -> None:
        """校验当前模型的 Key 已配置，否则给出明确的配置指引。"""
        if self._api_key in _PLACEHOLDER_KEYS:
            raise RuntimeError(
                f"模型 {self.model} 的 API Key 未配置，请在 backend/python/.env 填写 {self._api_key_env}"
            )

    @staticmethod
    def _att(att: Any) -> dict:
        """把 Attachment 模型或 dict 统一成 dict。"""
        return att if isinstance(att, dict) else att.model_dump()

    async def _load_audio_b64(self, url: str, mime: Optional[str]) -> tuple[str, str]:
        """下载音频附件并转 base64；同时推断 OpenAI input_audio 需要的 format 字段。"""
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.content
        if len(data) > _AUDIO_MAX_BYTES:
            raise RuntimeError("音频附件过大（超过 20MB），请压缩后再上传")
        fmt = "wav"
        if mime:
            # "audio/mpeg" -> "mp3"、"audio/mp4" -> "mp4"，未知时按扩展名兜底
            fmt = mime.split("/")[-1].split(";")[0] or fmt
        return base64.b64encode(data).decode("ascii"), fmt

    async def _content_parts(
        self, text: str, attachments: Optional[List[Any]]
    ) -> list:
        """把正文 + 附件组装成 OpenAI 多模态内容块列表。

        顺序：文档文本（提供上下文）→ 正文 → 图片 → 音频。
        """
        parts: list = []
        images: list = []
        audios: list = []
        for att in attachments or []:
            a = self._att(att)
            t = a.get("type")
            if t == "image":
                images.append({"type": "image_url", "image_url": {"url": a["url"]}})
            elif t == "audio":
                b64, fmt = await self._load_audio_b64(a["url"], a.get("mime"))
                audios.append(
                    {"type": "input_audio", "input_audio": {"data": b64, "format": fmt}}
                )
            elif t == "file":
                # 文档附件：有 text 时用提取内容，无 text（如视频/二进制）给模型一个提示
                title = a.get("name") or "附件"
                if a.get("text"):
                    parts.append(
                        {"type": "text", "text": f"【附件·{title}】\n{a['text']}"}
                    )
                else:
                    mime = a.get("mime") or ""
                    kind = "视频" if mime.startswith("video/") else "二进制"
                    parts.append(
                        {"type": "text", "text": f"【附件·{title}】（{kind}文件，无法提取文本内容）"}
                    )
        parts.append({"type": "text", "text": text})
        parts.extend(images)
        parts.extend(audios)
        return parts

    async def _build_messages(
        self,
        prompt: str,
        system: Optional[str] = None,
        history: Optional[List[dict]] = None,
        attachments: Optional[List[Any]] = None,
    ) -> List[dict]:
        """组装 OpenAI 对话消息列表：一条 system + 历史消息 + 本次 user（含多模态内容块）。"""
        messages: List[dict] = [
            {"role": "system", "content": system or MIMO_SYSTEM_PROMPT},  # 系统人设，未传则用默认
        ]
        # 历史轮次：让模型感知之前的对话内容（已按时间正序）；
        # 历史里带图片的消息同样以内容块形式回传，保持多轮视觉上下文
        if history:
            for msg in history:
                role = msg.get("role")
                if role not in ("user", "assistant") or not msg.get("content"):
                    continue
                att = msg.get("attachments")
                if att:
                    messages.append(
                        {
                            "role": role,
                            "content": await self._content_parts(msg["content"], att),
                        }
                    )
                else:
                    messages.append({"role": role, "content": msg["content"]})
        # 本次提问放在最后（附件内容块一并带上）
        messages.append(
            {"role": "user", "content": await self._content_parts(prompt, attachments)}
        )
        return messages

    async def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_completion_tokens: int = 2048,
        temperature: float = 0.7,
        history: Optional[List[dict]] = None,
        attachments: Optional[List[Any]] = None,
    ) -> str:
        """一次性返回完整生成结果（非流式）。"""
        self.ensure_ready()  # 当前模型的 Key 未配置时给出明确指引
        completion = await self._client.chat.completions.create(
            model=self.model,                              # 模型 ID
            messages=await self._build_messages(prompt, system, history, attachments),  # 对话消息
            max_completion_tokens=max_completion_tokens,   # 输出上限（MiMo 官方字段，含思考 token）
            temperature=temperature,                       # 随机性，越高越发散
            top_p=0.95,                                    # 核采样阈值
            stream=False,                                  # 非流式：等待完整结果
        )
        # choices[0] 为首选结果；content 可能为空，兜底返回空串
        return completion.choices[0].message.content or ""

    async def stream(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_completion_tokens: int = 2048,
        temperature: float = 0.3,
        history: Optional[List[dict]] = None,
        attachments: Optional[List[Any]] = None,
    ) -> AsyncIterator[tuple[Literal["thinking", "content"], str]]:
        """流式生成，逐段 yield (片段类型, 文本)。

        - ("thinking", text)：模型的思考过程 reasoning_content，正文开始前到达，
          供前端实时展示"思考中"，避免长时间空白等待；
        - ("content", text)：正文内容。
        """
        if not self.is_configured():
            self.ensure_ready()
        # stream=True 让接口边生成边返回分片
        stream = await self._client.chat.completions.create(
            model=self.model,
            messages=await self._build_messages(prompt, system, history, attachments),
            max_completion_tokens=max_completion_tokens,
            temperature=temperature,
            top_p=0.95,
            stream=True,
        )
        async for chunk in stream:
            if not chunk.choices:
                # 分片可能只含用量统计而无内容，跳过
                continue
            delta = chunk.choices[0].delta
            # mimo 思考模型把思考放在 reasoning_content，正文才在 content
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                # 思考过程也实时下发给上层（用于"思考中"展示），但不计入最终正文
                yield "thinking", reasoning
            content = getattr(delta, "content", None)
            if content:
                yield "content", content

    async def _stream_completion(
        self,
        messages: List[dict],
        max_completion_tokens: int,
        temperature: float,
        tools: Optional[list] = None,
    ) -> AsyncIterator[tuple[str, Any]]:
        """单次流式补全的统一出口。

        yield 的片段类型：
        - ("thinking", str)：思考过程；
        - ("content", str)：正文；
        - ("toolcall", delta)：工具调用增量分片（function arguments 可能分多片到达，
          由调用方按 index 拼接）。
        """
        kwargs: dict = {
            "model": self.model,
            "messages": messages,
            "max_completion_tokens": max_completion_tokens,
            "temperature": temperature,
            "top_p": 0.95,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools
        stream = await self._client.chat.completions.create(**kwargs)
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                yield "thinking", reasoning
            content = getattr(delta, "content", None)
            if content:
                yield "content", content
            for piece in getattr(delta, "tool_calls", None) or []:
                yield "toolcall", piece

    @staticmethod
    def _accumulate_toolcall(acc: Dict[int, dict], piece: Any) -> None:
        """把流式 tool_calls 增量分片按 index 累积成完整的 OpenAI tool_call 结构。"""
        idx = getattr(piece, "index", 0) or 0
        slot = acc.setdefault(
            idx,
            {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
        )
        if getattr(piece, "id", None):
            slot["id"] = piece.id
        fn = getattr(piece, "function", None)
        if fn is not None:
            if getattr(fn, "name", None):
                slot["function"]["name"] = fn.name
            if getattr(fn, "arguments", None):
                slot["function"]["arguments"] += fn.arguments

    async def _execute_image_tool(
        self, prompt: str, image_url: Optional[str] = None
    ) -> str:
        """执行生图/改图工具：回调 NestJS 内部接口（调图片服务 + 落 R2），返回图片可访问 URL。

        不带 image_url → 文生图；带 image_url → 基于该图改图（edits 端点）。
        改图实测可达 70s+，超时放宽到 320s。
        """
        payload: dict = {"prompt": prompt}
        if image_url:
            payload["image_url"] = image_url
        async with httpx.AsyncClient(timeout=320) as client:
            resp = await client.post(
                settings.IMAGE_TOOL_URL,
                json=payload,
                headers={"x-internal-token": settings.INTERNAL_TOKEN},
            )
            resp.raise_for_status()
            data = resp.json()
        url = data.get("url") if isinstance(data, dict) else None
        if not url:
            raise RuntimeError("图片接口未返回图片 URL")
        return url

    async def _strip_leading_think(
        self,
        aiter: AsyncIterator[tuple[str, Any]],
    ) -> AsyncIterator[tuple[str, Any]]:
        """剥掉正文开头的字面思考块 <antThinking>…</think|/antThinking>。

        思考块的字符可能被切成任意分片（甚至切在标签中间），用一个小状态机处理：
        - watch：正文刚开头，暂存少量字符判断是否以思考标签起始；
        - think：在思考块内，丢弃内容直到遇到闭标签；
        - pass：正常透传后续所有分片。
        thinking / toolcall 等非正文事件始终原样透传。
        """
        state = "watch"
        buf = ""
        async for kind, val in aiter:
            if kind != "content" or state == "pass":
                yield kind, val
                continue
            buf += val
            if state == "watch":
                stripped = buf.lstrip()
                if stripped.startswith(_THINK_OPEN):
                    # 确认是思考块：丢掉开头空白与开标签，进入丢弃态
                    state = "think"
                    buf = stripped[len(_THINK_OPEN):]
                elif _THINK_OPEN.startswith(stripped):
                    # 目前是标签的前缀（或纯空白），尚不能确定，继续暂存
                    if len(buf) > _THINK_WATCH_MAX:
                        state = "pass"
                        yield "content", buf
                        buf = ""
                    continue
                else:
                    # 确定不是思考标签：全部作为正常正文吐出
                    state = "pass"
                    yield "content", buf
                    buf = ""
            if state == "think":
                hits = [buf.find(c) for c in _THINK_CLOSES]
                hits = [i for i in hits if i >= 0]
                if hits:
                    i = min(hits)
                    close = next(c for c in _THINK_CLOSES if buf.startswith(c, i))
                    rest = buf[i + len(close):]
                    state = "pass"
                    buf = ""
                    if rest:
                        yield "content", rest
                elif len(buf) > _THINK_BLOCK_MAX:
                    # 兜底：迟迟等不到闭标签，不再吞内容，原样放行
                    state = "pass"
                    yield "content", buf
                    buf = ""

    async def stream_agent(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_completion_tokens: int = 4096,
        temperature: float = 0.3,
        history: Optional[List[dict]] = None,
        attachments: Optional[List[Any]] = None,
    ) -> AsyncIterator[tuple[Literal["thinking", "content", "image", "image_status"], str]]:
        """带工具能力的流式生成：模型自主决定是否调用 generate_image。

        流程（最多两轮）：
        1. 第一轮带 tools 流式输出；若模型只给文本 → 普通问答，直接结束；
        2. 若模型发起 generate_image 调用 → 回调 NestJS 生图，yield ("image", url)，
           把图片 URL 作为 tool 结果回填；第二轮不带工具，让模型用自然语言收尾。
        """
        if not self.is_configured():
            self.ensure_ready()

        messages = await self._build_messages(prompt, system, history, attachments)
        # 在系统提示词末尾追加工具使用说明
        if messages and messages[0].get("role") == "system":
            messages[0]["content"] = (
                (messages[0].get("content") or "") + "\n" + _TOOL_SYSTEM_SUFFIX
            )

        # ---- 第一轮：带生图/改图工具（经思考块过滤器）----
        text_parts: List[str] = []
        tool_acc: Dict[int, dict] = {}
        turn1 = self._strip_leading_think(
            self._stream_completion(
                messages,
                max_completion_tokens,
                temperature,
                tools=[GENERATE_IMAGE_TOOL, EDIT_IMAGE_TOOL],
            )
        )
        async for kind, val in turn1:
            if kind == "toolcall":
                self._accumulate_toolcall(tool_acc, val)
            else:
                if kind == "content":
                    text_parts.append(val)
                yield kind, val  # thinking / content 直接透传

        ordered_calls = [tool_acc[i] for i in sorted(tool_acc)]
        # 助手这一轮消息（可能含 tool_calls）必须原样回填，多轮工具协议要求
        assistant_msg: dict = {"role": "assistant", "content": "".join(text_parts) or None}
        if ordered_calls:
            assistant_msg["tool_calls"] = ordered_calls
        messages.append(assistant_msg)

        # 没有工具调用 → 普通问答已结束
        if not ordered_calls:
            return

        # 收集上下文中真实出现过的图片 URL（消息内容块里的 image_url）。
        # 模型调用 edit_image 时可能凭记忆编造图片地址（幻觉），执行前用白名单兜底替换。
        ctx_image_urls: List[str] = []
        for m in messages:
            c = m.get("content")
            if isinstance(c, list):
                for part in c:
                    if isinstance(part, dict) and part.get("type") == "image_url":
                        u = (part.get("image_url") or {}).get("url")
                        if u:
                            ctx_image_urls.append(u)

        # ---- 执行工具：generate_image（文生图）/ edit_image（改图）----
        for call in ordered_calls:
            name = call["function"]["name"]
            if name in ("generate_image", "edit_image"):
                try:
                    raw_args = call["function"]["arguments"] or "{}"
                    args = json.loads(raw_args)
                    img_prompt = (args.get("prompt") or prompt).strip()
                    src_url = (args.get("image_url") or "").strip() or None
                    if name == "edit_image":
                        if src_url and src_url not in ctx_image_urls:
                            # 幻觉 URL 兜底：替换为上下文中第一张真实图片
                            src_url = ctx_image_urls[0] if ctx_image_urls else None
                        if not src_url:
                            raise ValueError("edit_image 缺少可用的 image_url（会话中没有真实图片附件）")
                    yield "image_status", "正在修改图片…" if src_url else "正在生成图片…"
                    url = await self._execute_image_tool(img_prompt, src_url)
                    tool_content = json.dumps(
                        {"ok": True, "url": url}, ensure_ascii=False
                    )
                    # 图片 URL 事件：NestJS 收到后落库为图片附件并透传给前端
                    yield "image", url
                except Exception as e:
                    tool_content = json.dumps(
                        {"ok": False, "error": str(e)}, ensure_ascii=False
                    )
            else:
                tool_content = f"错误：未知工具 {name}"
            messages.append(
                {"role": "tool", "tool_call_id": call["id"], "content": tool_content}
            )

        # ---- 第二轮：不带工具，让模型基于工具结果自然收尾（同样剥离开头思考块）----
        turn2 = self._strip_leading_think(
            self._stream_completion(messages, max_completion_tokens, temperature, tools=None)
        )
        async for kind, val in turn2:
            if kind == "toolcall":
                continue
            yield kind, val
