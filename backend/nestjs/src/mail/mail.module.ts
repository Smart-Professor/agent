import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { UsersModule } from '../users/users.module';
import { MAIL_QUEUE } from '../common/contracts/mail-job.contract';

@Module({
  // MailService 需要查询邮箱是否已注册；BullModule 注入 mail 队列生产者
  imports: [UsersModule, BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [MailService],
  controllers: [MailController],
  exports: [MailService], // AuthModule 注册流程中复用验证码校验能力
})
export class MailModule {}
