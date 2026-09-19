"""工具能力：Agent 可调用的外部能力。"""

from .image import generate_image  # 导出文生图工具

__all__ = ["generate_image"]  # 声明包对外暴露的公共接口
