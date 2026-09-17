"""5 个创作 Agent 节点：story / character / scene / storyboard / interaction。

每个 worker 都是一次 LLM 调用：读主管指令 + 相关素材 → 产出文本写入 artifacts。
character / scene 会从产出中截取 IMAGE_PROMPT 行并调用文生图；
interaction 会截取 WORLD_STATE 行更新世界观状态。
"""

import re

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from .llm import get_llm
from .prompts import WORKER_PROMPTS
from .state import AgentState
from .tools import generate_image

IMAGE_LINE = re.compile(r"^\s*IMAGE_PROMPT:\s*(.+)$", re.MULTILINE)
WORLD_LINE = re.compile(r"^\s*WORLD_STATE:\s*(.+)$", re.MULTILINE)
MAX_IMAGES = 3  # 单次产出最多生成几张图，控制成本

# 每个 worker 需要读取哪些 artifacts 素材；存放到哪个 artifacts 字段
WORKER_SPECS = {
    "story": {"artifact": "story", "context": ["world_state", "story"]},
    "character": {"artifact": "characters", "context": ["story", "world_state"], "image": True},
    "scene": {"artifact": "scenes", "context": ["story", "characters", "world_state"], "image": True},
    "storyboard": {"artifact": "storyboard", "context": ["story", "characters", "scenes", "world_state"]},
    "interaction": {"artifact": "interaction", "context": ["story", "characters", "scenes", "world_state"], "world": True},
}


def _context(artifacts: dict[str, str], keys: list[str]) -> str:
    blocks = [f"【{k}】\n{artifacts[k]}" for k in keys if artifacts.get(k)]
    return "\n\n".join(blocks) if blocks else "（暂无，你是第一个创作的）"


def _run_images(agent: str, text: str) -> tuple[str, list[dict]]:
    """截取产出中的 IMAGE_PROMPT 行并逐条生图，失败记录 error 不中断。"""
    prompts = IMAGE_LINE.findall(text)[:MAX_IMAGES]
    text = IMAGE_LINE.sub("", text).strip()
    images = []
    for prompt in prompts:
        try:
            images.append({"agent": agent, "prompt": prompt, "url": generate_image(prompt)})
        except Exception as exc:  # 生图失败不影响文本产出
            images.append({"agent": agent, "prompt": prompt, "url": None, "error": str(exc)})
    return text, images


def _make_worker(name: str):
    spec = WORKER_SPECS[name]

    def node(state: AgentState) -> dict:
        text = get_llm().invoke(
            [
                SystemMessage(content=WORKER_PROMPTS[name]),
                HumanMessage(
                    content=(
                        f"主管指令：{state.get('instruction', '')}\n\n"
                        f"相关素材：\n{_context(state.get('artifacts', {}), spec['context'])}\n\n"
                        f"用户最新输入：{state.get('user_input', '') or '（无）'}"
                    )
                ),
            ]
        ).content

        images: list[dict] = []
        if spec.get("image"):
            text, images = _run_images(name, text)

        artifacts = {**state.get("artifacts", {})}
        if spec.get("world"):  # 互动叙事：截取 WORLD_STATE 更新世界观
            match = WORLD_LINE.search(text)
            if match:
                text = WORLD_LINE.sub("", text).strip()
                artifacts["world_state"] = match.group(1).strip()
        artifacts[spec["artifact"]] = text

        return {
            "messages": [AIMessage(content=text, name=name)],
            "artifacts": artifacts,
            "reports": [f"【{name}】{text[:60]}…"],
            "images": images,
        }

    return node


def build_workers() -> dict:
    return {name: _make_worker(name) for name in WORKER_SPECS}
