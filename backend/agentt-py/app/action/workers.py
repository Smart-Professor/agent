"""5 个创作 Agent 节点：story / character / scene / storyboard / interaction。

每个 worker 都是一次 LLM 调用：读主管指令 + 相关素材 → 产出文本写入 artifacts。
character / scene 会从产出中截取 IMAGE_PROMPT 行并调用文生图；
interaction 会截取 WORLD_STATE 行更新世界观状态。
"""

import re  # 导入正则库，用于截取产出中的 IMAGE_PROMPT / WORLD_STATE 行

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage  # 导入消息类型：系统提示/用户材料/模型产出

from ..memory.state import AgentState  # 导入共享状态类型（仅用于类型标注）
from ..tools.image import generate_image  # 导入文生图工具
from .llm import get_llm  # 导入 GLM 客户端工厂
from .prompts import WORKER_PROMPTS  # 导入各 worker 的系统提示词映射

IMAGE_LINE = re.compile(r"^\s*IMAGE_PROMPT:\s*(.+)$", re.MULTILINE)  # 匹配产出中的 IMAGE_PROMPT 行（多行模式）
WORLD_LINE = re.compile(r"^\s*WORLD_STATE:\s*(.+)$", re.MULTILINE)  # 匹配产出中的 WORLD_STATE 行
MAX_IMAGES = 3  # 单次产出最多生成几张图，控制成本

# 每个 worker 需要读取哪些 artifacts 素材；存放到哪个 artifacts 字段
WORKER_SPECS = {  # worker 配置表：产出字段、上下文素材、是否生图、是否维护世界观
    "story": {"artifact": "story", "context": ["world_state", "story"]},  # 故事：读世界观+旧故事，产出写入 story
    "character": {"artifact": "characters", "context": ["story", "world_state"], "image": True},  # 角色：读故事，立绘提示词需生图
    "scene": {"artifact": "scenes", "context": ["story", "characters", "world_state"], "image": True},  # 场景：读故事+角色，概念图需生图
    "storyboard": {"artifact": "storyboard", "context": ["story", "characters", "scenes", "world_state"]},  # 分镜：读故事+角色+场景
    "interaction": {"artifact": "interaction", "context": ["story", "characters", "scenes", "world_state"], "world": True},  # 互动：需更新世界观
}


def _context(artifacts: dict[str, str], keys: list[str]) -> str:  # 把指定素材拼成给模型看的上下文文本
    blocks = [f"【{k}】\n{artifacts[k]}" for k in keys if artifacts.get(k)]  # 只取非空素材，加【标签】便于模型区分
    return "\n\n".join(blocks) if blocks else "（暂无，你是第一个创作的）"  # 有素材用空行拼接；全空给占位提示


def _run_images(agent: str, text: str) -> tuple[str, list[dict]]:  # 截取生图提示词并逐条生图
    """截取产出中的 IMAGE_PROMPT 行并逐条生图，失败记录 error 不中断。"""
    prompts = IMAGE_LINE.findall(text)[:MAX_IMAGES]  # 提取全部 IMAGE_PROMPT 行，最多取 MAX_IMAGES 条
    text = IMAGE_LINE.sub("", text).strip()  # 从正文删掉这些提示词行，避免混入展示文本
    images = []  # 生图结果列表：{agent, prompt, url, error?}
    for prompt in prompts:  # 逐条调用文生图
        try:  # 单张失败不影响其余图片与正文
            images.append({"agent": agent, "prompt": prompt, "url": generate_image(prompt)})  # 成功：记录图片 URL
        except Exception as exc:  # 生图失败不影响文本产出
            images.append({"agent": agent, "prompt": prompt, "url": None, "error": str(exc)})  # 失败：记录错误信息
    return text, images  # 返回清理后的正文与生图记录


def _make_worker(name: str):  # worker 节点工厂：按名字生成一个闭包节点
    spec = WORKER_SPECS[name]  # 取该 worker 的配置（素材、产出字段、生图/世界观开关）

    def node(state: AgentState) -> dict:  # LangGraph 节点函数：读状态，返回状态增量
        text = get_llm().invoke(  # 调用 GLM（默认温度），同步获取完整产出
            [
                SystemMessage(content=WORKER_PROMPTS[name]),  # 系统提示词：该 Agent 的角色与输出格式
                HumanMessage(  # 用户消息：主管指令 + 素材 + 用户输入
                    content=(
                        f"主管指令：{state.get('instruction', '')}\n\n"  # 主管下达的具体任务指令
                        f"相关素材：\n{_context(state.get('artifacts', {}), spec['context'])}\n\n"  # 已有产物素材上下文
                        f"用户最新输入：{state.get('user_input', '') or '（无）'}"  # 用户本轮输入（互动叙事用）
                    )
                ),
            ]
        ).content  # 取模型返回的文本内容

        images: list[dict] = []  # 生图记录，默认为空
        if spec.get("image"):  # 该 worker 配置了生图（character/scene）
            text, images = _run_images(name, text)  # 截取提示词并生图，同时清理正文

        artifacts = {**state.get("artifacts", {})}  # 复制现有产物，避免原地修改共享状态
        if spec.get("world"):  # 互动叙事：截取 WORLD_STATE 更新世界观
            match = WORLD_LINE.search(text)  # 在正文中查找 WORLD_STATE 行
            if match:  # 找到才更新
                text = WORLD_LINE.sub("", text).strip()  # 从正文删掉该行
                artifacts["world_state"] = match.group(1).strip()  # 把内容写入世界观状态
        artifacts[spec["artifact"]] = text  # 把本 worker 正文写入对应的产物字段

        return {  # 返回状态增量：LangGraph 会按字段合并策略合入全局状态
            "messages": [AIMessage(content=text, name=name)],  # 对话历史追加本 worker 的产出
            "artifacts": artifacts,  # 更新后的产物字典
            "reports": [f"【{name}】{text[:60]}…"],  # 给主管的简报（截前 60 字）
            "images": images,  # 生图记录（可能为空）
        }

    return node  # 返回闭包好的节点函数


def build_workers() -> dict:  # 构建全部 worker 节点，供 graph.py 注册
    return {name: _make_worker(name) for name in WORKER_SPECS}  # 名字 → 节点函数 的字典
