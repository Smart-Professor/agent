import { Logger, OnModuleInit } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { EmailUtil } from '../common/utils/email.util';
import {
  JOB_SEND_CODE,
  JOB_SEND_RAW,
  MAIL_QUEUE,
  type SendCodeJobData,
  type SendRawJobData,
} from '../contracts/mail-job.contract';

/**
 * 邮件队列消费者
 *
 * 只负责"取任务 → 调 SMTP 发信"，不关心用户体系 / 验证码生成 / 频控，
 * 这些业务逻辑全部留在主服务。任务失败由 Bull 按 MAIL_JOB_OPTS 自动重试。
 */
@Processor(MAIL_QUEUE)
export class MailProcessor implements OnModuleInit {
  private readonly logger = new Logger(MailProcessor.name);

  async onModuleInit(): Promise<void> {
    // 启动时探测一次 SMTP；配置有误只告警不退出，发信错误交给 Bull 重试
    try {
      await EmailUtil.verify();
      this.logger.log('SMTP 邮件服务连接正常，开始监听 mail 队列');
    } catch (e) {
      this.logger.warn(
        `SMTP 探测失败（请检查 .env 中 MAIL_USER / MAIL_PASS 授权码）: ${(e as Error).message}`,
      );
      this.logger.warn('Worker 仍会继续运行，任务将按重试策略重试');
    }
  }

  /** 发送注册验证码 */
  @Process(JOB_SEND_CODE)
  async handleSendCode(job: Job<SendCodeJobData>): Promise<void> {
    const { to, code, ttlMinutes } = job.data;
    this.logger.log(
      `[job ${job.id}] 发送注册验证码 -> ${to}（第 ${job.attemptsMade + 1} 次尝试）`,
    );
    await EmailUtil.sendVerificationCode(to, code, ttlMinutes);
    this.logger.log(`[job ${job.id}] 验证码邮件投递成功 -> ${to}`);
  }

  /** 通用发信（JWT 保护的 /mail/send） */
  @Process(JOB_SEND_RAW)
  async handleSendRaw(job: Job<SendRawJobData>): Promise<void> {
    const { to, subject, html, text } = job.data;
    this.logger.log(
      `[job ${job.id}] 发送通用邮件 -> ${to}：${subject}（第 ${job.attemptsMade + 1} 次尝试）`,
    );
    await EmailUtil.sendMail({ to, subject, html, text });
    this.logger.log(`[job ${job.id}] 通用邮件投递成功 -> ${to}`);
  }

  /** 所有重试耗尽后仍失败的兜底日志 */
  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    this.logger.error(
      `[job ${job.id}] 任务最终失败（已尝试 ${job.attemptsMade} 次，name=${job.name}）: ${error.message}`,
      error.stack,
    );
  }
}
