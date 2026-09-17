"""模型注册表：添加新的大模型只需在此处加一行配置。

每个条目：
- label:        前端下拉显示的名称
- base_url:     OpenAI 兼容端点（大多数厂商都提供，如 DeepSeek/Qwen/Kimi/GLib 等）
- api_key_env:  读取哪个环境变量作为鉴权 Key（在 backend/python/.env 中配置）
- system_prompt: 可选，该模型的专属系统人设；不填用 MiMo 默认

添加步骤（示例：接入 DeepSeek）：
1. 在 backend/python/.env 中加一行：DEEPSEEK_API_KEY=sk-xxxxx
2. 在下面的 MODEL_REGISTRY 中加一个条目：
   "deepseek-chat": {
       "label": "DeepSeek V3",
       "base_url": "https://api.deepseek.com/v1",
       "api_key_env": "DEEPSEEK_API_KEY",
   },
3. 重启 Python 服务，前端下拉即会出现该模型（见前端 stores/app.ts 的 MODEL_OPTIONS）。

注意：只要厂商兼容 OpenAI Chat Completions 协议（绝大多数都兼容）即可直接接入；
若模型有思考过程（reasoning_content），网关会自动透传为前端"思考中"展示。
"""
import os
from typing import Optional

from app.core.config import settings  # 全局配置（.env）

# model_id -> 提供商连接参数
# capabilities 声明该模型具备的多模态能力，前端据此决定附件功能是否可用：
# - vision: 图片理解（OpenAI image_url 内容块）
# - audio:  语音/音频理解（OpenAI input_audio 内容块）
# 不声明能力的模型 = 纯文本，上传图片时前端直接拦截提示
MODEL_REGISTRY: dict[str, dict] = {
    # ---- 小米 MiMo（默认提供商，Key 在 MIMO_API_KEY）----
    "mimo-v2.5": {
        "label": "MiMo v2.5（默认 · 响应快）",
        "base_url": settings.MIMO_BASE_URL,
        "api_key_env": "MIMO_API_KEY",
        "capabilities": {"vision": True, "audio": False},
    },
    "mimo-v2.5-pro": {
        "label": "MiMo v2.5 Pro（深度推理 · 较慢）",
        "base_url": settings.MIMO_BASE_URL,
        "api_key_env": "MIMO_API_KEY",
        "capabilities": {"vision": True, "audio": False},
    },
    "GLM-5.3-Flash": {
        "label": "GLM-5.3 Flash（便宜快速 · 开发推荐）",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "api_key_env": "GMLMODEL_API_KEY",
        "capabilities": {"vision": True, "audio": False},
    },
    # ---- 在这里添加其他厂商的模型，参照文件头部的示例 ----
}

# 模型不具备能力声明时的默认值（纯文本模型）
_DEFAULT_CAPABILITIES = {"vision": False, "audio": False}


def get_model_capabilities(model_id: Optional[str]) -> dict:
    """查询某个模型声明的多模态能力（未知模型按纯文本处理）。"""
    entry = MODEL_REGISTRY.get(model_id or "")
    caps = dict(_DEFAULT_CAPABILITIES)
    if entry:
        caps.update(entry.get("capabilities") or {})
    return caps


def list_models() -> list[dict]:
    """列出全部可用模型（id / label / capabilities），供 /agent/models 接口与前端下拉使用。"""
    return [
        {
            "id": model_id,
            "label": entry["label"],
            "capabilities": get_model_capabilities(model_id),
        }
        for model_id, entry in MODEL_REGISTRY.items()
    ]


def resolve_provider(model_id: Optional[str]) -> tuple[str, str, str]:
    """按模型 ID 解析出 (base_url, api_key, api_key_env)，未知模型回退 MiMo 默认。"""
    entry = MODEL_REGISTRY.get(model_id or "") or MODEL_REGISTRY["mimo-v2.5"]
    api_key = os.environ.get(entry["api_key_env"], "") or getattr(settings, entry["api_key_env"], "")
    return entry["base_url"], api_key, entry["api_key_env"]
