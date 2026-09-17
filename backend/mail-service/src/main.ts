import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * 邮件 Worker 入口
 *
 * 使用 createApplicationContext 启动纯 DI 上下文（不加载 HTTP 平台）：
 * Bull 处理器在模块的 onModuleInit 生命周期完成注册，
 * 与 Redis 的长连接会让进程持续存活，因此不需要 listen 任何端口。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  // 支持 Ctrl+C 时优雅关闭 Bull / Redis 连接
  app.enableShutdownHooks();

  const logger = new Logger('Bootstrap');
  logger.log('Mail Worker 已启动，正在消费 Redis 中的 mail 队列（无 HTTP 端口）');
}

void bootstrap();
