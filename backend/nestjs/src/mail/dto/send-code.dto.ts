import { IsEmail } from 'class-validator';

/** 发送注册验证码入参 */
export class SendCodeDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;
}
