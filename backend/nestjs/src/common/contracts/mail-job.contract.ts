/**
 * Bull 邮件队列契约
 *
 * ⚠️ 本文件必须与独立邮件服务
 *    backend/mail-service/src/contracts/mail-job.contract.ts
 *    保持逐字一致（队列名 / 任务名 / payload 字段是两个服务唯一的耦合点）。
 *    后期可抽成独立 shared npm 包消除复制。
 */

/** 队列名 */
export const MAIL_QUEUE = 'mail';

/** 任务名：注册验证码 */
export const JOB_SEND_CODE = 'send-code';

/** 任务名：通用发信（需登录的 /mail/send 接口） */
export const JOB_SEND_RAW = 'send-raw';

/** send-code 任务载荷 */
export interface SendCodeJobData {
  /** 收件邮箱 */
  to: string;
  /** 6 位数字验证码 */
  code: string;
  /** 验证码有效期（分钟），仅用于邮件文案 */
  ttlMinutes: number;
}

/** send-raw 任务载荷 */
export interface SendRawJobData {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

/**
 * 入队选项：
 * - 失败自动重试 3 次，指数退避（3s / 6s / 12s）
 * - 成功 / 失败任务各保留最近 100 条，便于在 Redis 中排查
 */
export const MAIL_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 3000 },
  removeOnComplete: 100,
  removeOnFail: 100,
};

/** 生产者等待 Worker 执行结果的超时时间（毫秒） */
export const MAIL_JOB_TIMEOUT = 20_000;
