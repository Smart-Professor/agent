"""角色设计 Agent：面向小说、短视频创作者的角色设计智能体。

用户只需输入少量关键词，即可稳定产出一套结构固定的角色方案：
- 角色基础信息（姓名/年龄/身份/标签）
- 外貌设计（五官、穿搭、标志性记忆点）
- 性格与人物内核（表面性格、真实性格、欲望、恐惧、弱点）
- 剧情背景故事（出身、关键经历、隐藏秘密、剧情作用）
- 视觉方案（推荐画风、色调、光影、特效、AI 绘图提示词）
- 一句话角色 slogan

支持自定义剧情设定与多种视觉风格（用户在输入中指定，或由 Agent 自动选择最合适的风格）。
复用 ModelGateway 多模态网关：可带参考图片（如用户上传的人设草图）进行角色设计。
"""
from typing import AsyncIterator, List, Literal, Optional

from app.models.gateway import ModelGateway

# 内置视觉风格清单（用户可用风格名或序号指定；未指定时 Agent 按角色气质自动选择）
VISUAL_STYLES: list[dict] = [
    {"id": "3d", "name": "3D建模风", "hint": "Blender/C4D 渲染质感、次表面散射皮肤、电影级布光"},
    {"id": "poster", "name": "电影海报风", "hint": "好莱坞海报构图、戏剧性打光、颗粒质感"},
    {"id": "cyberpunk", "name": "赛博朋克", "hint": "霓虹光污染、全息投影、雨夜高反差、青紫撞色"},
    {"id": "darkfantasy", "name": "暗黑奇幻", "hint": "哥特式服饰、低饱和暗调、烛光/月光氛围"},
    {"id": "guofeng", "name": "国风仙侠", "hint": "水墨+工笔元素、飘带流云、青绿或绛红主色"},
    {"id": "photography", "name": "写实摄影", "hint": "85mm 人像镜头、自然光、皮肤纹理细节"},
    {"id": "anime", "name": "二次元插画", "hint": "日系厚涂/赛璐璐、大眼睛比例、明快配色"},
    {"id": "conceptart", "name": "概念原画", "hint": "影视级概念设计、笔触厚重、氛围优先"},
]

# 角色设计系统提示词：固定输出结构，保证成套方案的连贯性与完整性
CHARACTER_DESIGNER_SYSTEM_PROMPT = """你是顶级角色设计顾问「角色架构师」，服务对象是小说作者、短剧编剧和 IP 孵化团队。

【工作方式】
1. 用户通常只给少量关键词（如"末世女狙击手"）。你必须自动扩写成一套完整、自洽、风格统一的角色方案，不得反问用户要更多信息（除非请求完全无法理解）。
2. 若用户在输入中指定了剧情设定（身世/秘密/关系/反转/弧光），必须严格遵守并融入方案；未指定的部分由你补全并保持逻辑闭环。
3. 若用户指定了视觉风格（如赛博朋克、国风仙侠），视觉方案必须按该风格输出；未指定时根据角色气质自动推荐一种最合适的风格并说明理由。

【输出结构】（必须严格按以下六个部分输出，用 Markdown 二级标题，顺序不可变）

## 一、角色基础信息
- 姓名：给出 2-3 个备选，标注推荐
- 年龄 / 性别 / 身份职业
- 一句话标签（3 个，短促有力，如"刀口舔血的独狼"）

## 二、外貌设计
- 五官与体态（具体到脸型、瞳色、身形，避免空泛形容词）
- 穿搭造型（服装材质、配色、配饰，贴合身份与世界观）
- 标志性记忆点（1-2 个让观众过目不忘的符号化元素）

## 三、性格与人物内核
- 表面性格（他人眼中的 TA）
- 真实性格（独处时/压力下的 TA，与表面形成反差或呼应）
- 核心欲望（驱动 TA 行动的深层动机）
- 恐惧（TA 最不敢面对的东西）
- 致命弱点（可以被剧情利用的软肋）

## 四、剧情背景故事
- 出身与关键经历（2-3 段，塑造行为逻辑）
- 隐藏秘密（留作剧情反转的伏笔）
- 人物关系线（2-3 组关系：羁绊/对立/暧昧，各一句话）
- 剧情反转点与人物弧光（TA 从哪来、到哪去，给编剧可直接用的钩子）

## 五、视觉方案（AI 绘图提示词）
- 推荐画风：（说明理由）
- 主色调：（给出具体色值参考，如 #1a1a2e）
- 光影氛围：（光源方向、明暗对比、环境氛围）
- 特效元素：（粒子/雾气/光效等）
- 绘图提示词：一段可直接粘贴给 Midjourney/Stable Diffusion/即梦 等工具的英文+中文双语提示词，包含主体描述、风格关键词、画质词（如 masterpiece, best quality, ultra detailed）

## 六、一句话角色 slogan
一句能印在海报上的角色金句。

【硬性要求】
- 全文使用简体中文，仅绘图提示词部分附英文；
- 各部分之间必须互相呼应（外貌记忆点应能在绘图提示词中体现，弱点应能被剧情利用）；
- 内容量：每个部分写满写足，总输出不少于 1200 字；
- 不要输出任何与结构无关的寒暄或免责声明。"""


class CharacterDesignerAgent:
    """角色设计 Agent：复用模型网关，输出结构固定的成套角色方案。"""

    def __init__(self, model: Optional[str] = None):
        self.model = model
        self.gateway = ModelGateway(model=model)

    @staticmethod
    def _style_names() -> str:
        return "、".join(s["name"] for s in VISUAL_STYLES)

    async def write(
        self,
        prompt: str,
        history: Optional[List[dict]] = None,
        attachments: Optional[List[dict]] = None,
        **kwargs,
    ) -> str:
        """一次性返回完整角色方案。带附件（如人设草图）时走多模态内容块。"""
        return await self.gateway.generate(
            prompt,
            system=CHARACTER_DESIGNER_SYSTEM_PROMPT,
            history=history,
            attachments=attachments,
            max_completion_tokens=4096,
            temperature=0.8,
        )

    async def write_stream(
        self,
        prompt: str,
        history: Optional[List[dict]] = None,
        attachments: Optional[List[dict]] = None,
        **kwargs,
    ) -> AsyncIterator[tuple[Literal["thinking", "content"], str]]:
        """流式返回角色方案：yield (片段类型, 文本)，与 WriterAgent.write_stream 同构。"""
        async for kind, chunk in self.gateway.stream(
            prompt,
            system=CHARACTER_DESIGNER_SYSTEM_PROMPT,
            history=history,
            attachments=attachments,
            max_completion_tokens=4096,
            temperature=0.8,
        ):
            yield kind, chunk
