import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { MailProcessor } from './processors/mail.processor';
import { MAIL_QUEUE } from './contracts/mail-job.contract';

/**
 * 邮件 Worker 应用
 *
 * 纯消费者：不启动 HTTP 端口（main.ts 中不调用 listen），
 * 依赖只有 Redis（Bull 队列）和 SMTP（nodemailer）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST'),
          port: Number(config.get<string>('REDIS_PORT') ?? 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    BullModule.registerQueue({ name: MAIL_QUEUE }),
  ],
  providers: [MailProcessor],
})
export class AppModule {}
