"""基础工具集：LangChain Agent 可调用的能力注册表。

Agent 的核心是"模型自主决定何时调用工具"。每个工具用 @tool 装饰器声明，
LangChain 会自动把函数签名 + docstring 转成 function calling 的 tool schema。

新增工具步骤：
1. 在下面写一个带类型注解和 docstring 的函数，套上 @tool；
2. 在 get_tools() 返回列表里加上它，Agent 立即可用。
"""
from datetime import datetime  # 获取当前时间

from langchain_core.tools import tool  # LangChain 工具装饰器


@tool
def get_current_time() -> str:
    """获取当前的日期和时间。当用户询问现在几点、今天日期、时差计算等问题时使用。"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@tool
def calculator(expression: str) -> str:
    """计算一个数学表达式并返回结果。expression 只支持 Python 数学语法，例如 (3+5)*12/2。
    当用户的问题需要精确计算（加减乘除、百分比、幂运算等）时使用，不要心算。"""
    # 安全限制：只允许数字与数学运算符/函数，杜绝任意代码执行
    allowed = set("0123456789+-*/().% ")
    if not expression or not set(expression) <= allowed:
        return "错误：表达式只能包含数字和 + - * / ( ) % 运算符"
    try:
        # eval 前已做字符白名单校验，且不含字母，无代码注入面
        result = eval(expression)  # noqa: S307
        return str(result)
    except Exception as e:
        return f"计算失败: {e}"


@tool
def text_stats(text: str) -> str:
    """统计一段文本的字数、词数和预估阅读时长。当用户问"这段有多少字"等文本统计问题时使用。"""
    chars = len(text)
    words = len(text.split())
    minutes = max(1, round(chars / 400))  # 中文约 400 字/分钟
    return f"字符数={chars}，词数={words}，预计阅读约 {minutes} 分钟"


def get_tools() -> list:
    """返回注册给 Agent 的全部工具列表。"""
    return [get_current_time, calculator, text_stats]
