import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/** 通用发信参数 */
export interface SendMailOptions {
  to: string;
  subject: string;
  /** HTML 正文（与 text 至少传一个） */
  html?: string;
  /** 纯文本正文 */
  text?: string;
}

/**
 * 邮件工具类（纯静态实现，与 NestJS 框架无关）
 *
 * - 配置直接读取 process.env（MAIL_HOST / MAIL_PORT / MAIL_USER / MAIL_PASS ...）
 * - SMTP 连接为进程级单例，首次调用时懒加载
 * - 从主服务整体迁移而来，行为与原实现完全一致
 */
export class EmailUtil {
  private static transporter: Transporter | null = null;

  /** 获取（或首次创建）SMTP 传输器 */
  private static getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_PASS;

    if (!user || !pass || user.startsWith('your_mailbox')) {
      throw new Error(
        '邮件服务未配置：请先在 .env 中填写 MAIL_USER（完整 163 邮箱）和 MAIL_PASS（SMTP 授权码）',
      );
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST ?? 'smtp.163.com',
      port: Number(process.env.MAIL_PORT ?? 465),
      // 465 用 SSL（true），587 用 STARTTLS（false）
      secure: process.env.MAIL_SECURE !== 'false',
      auth: { user, pass },
    });

    return this.transporter;
  }

  /** 探测 SMTP 服务连通性 / 授权码是否有效 */
  static async verify(): Promise<void> {
    await this.getTransporter().verify();
  }

  /** 发送任意邮件 */
  static async sendMail(options: SendMailOptions): Promise<void> {
    const fromName = process.env.MAIL_FROM_NAME ?? 'Agent';
    await this.getTransporter().sendMail({
      from: `"${fromName}" <${process.env.MAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }

  /** 发送注册验证码邮件（内置 HTML 模板） */
  static async sendVerificationCode(
    to: string,
    code: string,
    ttlMinutes = 5,
  ): Promise<void> {
    await this.sendMail({
      to,
      subject: `【Agent】注册验证码：${code}`,
      html: this.buildCodeHtml(code, ttlMinutes),
    });
  }

  private static buildCodeHtml(code: string, ttlMinutes: number): string {
    return `
      <div style="margin:0;padding:32px 0;background:#f4f5f7;font-family:'Helvetica Neue',Arial,sans-serif;">
        <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px 36px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
          <h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">完成邮箱注册</h2>
          <p style="margin:0 0 28px;font-size:14px;color:#6b7280;">你正在注册 Agent 账号，请使用以下验证码完成注册：</p>
          <div style="text-align:center;margin:0 0 24px;">
            <span style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:10px;color:#4f46e5;background:#eef2ff;border-radius:10px;padding:16px 28px;">${code}</span>
          </div>
          <p style="margin:0 0 4px;font-size:13px;color:#9ca3af;text-align:center;">验证码 ${ttlMinutes} 分钟内有效，请尽快使用</p>
          <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">若非本人操作，请忽略此邮件</p>
        </div>
      </div>
    `;
  }
}
