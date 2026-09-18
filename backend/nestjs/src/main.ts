import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 允许前端（Vite 15173）跨域访问
  app.enableCors();

  // 全局参数校验：自动校验 DTO，剥离未声明字段
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 端口是跨服务硬约定：Vite 代理（frontend/vite.config.ts）与 Python 的 IMAGE_TOOL_URL
  // 都写死了 13000；根 .env 不放 PORT（Python 的 PORT 是 18000，同名易混），故在此写死
  const port = 13000;
  await app.listen(port);
  console.log(`NestJS application is running on: http://localhost:${port}`);
}
bootstrap();
