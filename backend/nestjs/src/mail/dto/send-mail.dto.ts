import { IsEmail, IsString, Length } from 'class-validator';

/** 通用发信入参（需登录态，防止接口变成开放转发） */
export class SendMailDto {
  @IsEmail({}, { message: '收件人邮箱格式不正确' })
  to: string;

  @IsString()
  @Length(1, 100, { message: '邮件标题长度需在 1-100 字之间' })
  subject: string;

  /** 邮件正文（按 HTML 发送，纯文本内容也可正常显示） */
  @IsString()
  @Length(1, 20000, { message: '邮件内容长度需在 1-20000 字之间' })
  content: string;
}
