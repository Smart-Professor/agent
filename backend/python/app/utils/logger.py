"""日志工具：提供统一格式的 stdout 日志器。"""
import logging  # Python 标准日志库
import sys      # 用于指定输出流 stdout


def get_logger(name: str = "ai-creator") -> logging.Logger:
    """获取一个带统一格式的命名日志器（同名只初始化一次，避免重复 handler）。"""
    logger = logging.getLogger(name)
    if not logger.handlers:
        # 输出到标准输出，便于容器/进程日志采集
        handler = logging.StreamHandler(sys.stdout)
        # 日志格式：时间 | 级别 | 日志器名 | 消息
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"
            )
        )
        logger.addHandler(handler)   # 挂载处理器
        logger.setLevel(logging.INFO)  # 默认输出 INFO 及以上级别
    return logger
