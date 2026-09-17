import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  JOB_SEND_CODE,
  JOB_SEND_RAW,
  MAIL_JOB_OPTS,
  MAIL_JOB_TIMEOUT,
  MAIL_QUEUE,
  type SendCodeJobData,
  type SendRawJobData,
} from '../common/contracts/mail-job.contract';

/** 验证码有效期（秒） */
const CODE_TTL = 5 * 60;
/** 同一邮箱重新发送间隔（秒） */
const RESEND_INTERVAL = 60;

const codeKey = (email: string) => `mail:code:register:${email}`;
const limitKey = (email: string) => `mail:code:limit:${email}`;

/** 校验结果：通过 / 已过期 / 不匹配 */
export type CodeCheckResult = 'ok' | 'expired' | 'wrong';

/**
 * 邮件业务服务（消息队列生产者）
 *
 * 本层只负责业务：注册码生成、Redis 存储、有效期与 60s 频控；
 * 真正的 SMTP 发信在独立的 mail-service 中消费完成。
 * 入队后通过 job.finished() 等待 Worker 结果，接口语义与原来同步发信一致。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly usersService: UsersService,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue<SendCodeJobData | SendRawJobData>,
  ) {}

  /**
   * 等待队列任务执行完成（带超时）
   * Worker 未启动时，Bull 会挂起任务，这里给出明确错误而非无限等待
   */
  private async awaitJobResult<T>(job: Job<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('邮件服务未响应，请确认 mail-service 已启动'));
      }, MAIL_JOB_TIMEOUT);
    });
    try {
      return (await Promise.race([job.finished(), timeout])) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 发送注册验证码
   * 已注册拦截 + 60s 频控 + 5 分钟有效期；Worker 执行失败自动解除频控
   */
  async sendRegisterCode(rawEmail: string): Promise<void> {
    const email = rawEmail.toLowerCase().trim();

    if (await this.usersService.existsByEmail(email)) {
      throw new ConflictException('该邮箱已被注册');
    }

    if ((await this.redisService.exists(limitKey(email))) === 1) {
      const ttl = await this.redisService.ttl(limitKey(email));
      throw new HttpException(
        `发送过于频繁，请 ${ttl > 0 ? ttl : RESEND_INTERVAL} 秒后重试`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.redisService.setex(codeKey(email), CODE_TTL, code);
    await this.redisService.setex(limitKey(email), RESEND_INTERVAL, '1');

    try {
      const job = await this.mailQueue.add(JOB_SEND_CODE, {
        to: email,
        code,
        ttlMinutes: CODE_TTL / 60,
      } satisfies SendCodeJobData, MAIL_JOB_OPTS);
      await this.awaitJobResult(job);
      this.logger.log(`注册验证码已发送至 ${email}`);
    } catch (e) {
      // 发送失败（含 Worker 未启动 / SMTP 失败 / 重试耗尽）：解除频控，允许立即重试
      await this.redisService.del(limitKey(email));
      throw new InternalServerErrorException(
        `验证码邮件发送失败，请稍后重试：${(e as Error).message}`,
      );
    }
  }

  /** 校验注册验证码（不删除，注册成功后需再调用 clearRegisterCode） */
  async checkRegisterCode(rawEmail: string, code: string): Promise<CodeCheckResult> {
    const email = rawEmail.toLowerCase().trim();
    const cached = await this.redisService.get(codeKey(email));
    if (!cached) return 'expired';
    return cached === code ? 'ok' : 'wrong';
  }

  /** 注册成功后销毁验证码与频控键（一次性使用） */
  async clearRegisterCode(rawEmail: string): Promise<void> {
    const email = rawEmail.toLowerCase().trim();
    await this.redisService.del(codeKey(email));
    await this.redisService.del(limitKey(email));
  }

  /** 通用发信（入队 send-raw 任务，等待 Worker 投递完成） */
  async sendRaw(options: SendRawJobData): Promise<void> {
    const job = await this.mailQueue.add(JOB_SEND_RAW, options, MAIL_JOB_OPTS);
    await this.awaitJobResult(job);
  }
}
