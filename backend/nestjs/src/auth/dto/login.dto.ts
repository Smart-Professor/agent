import { IsEmail, IsString, MinLength } from 'class-validator';

/** 登录入参 */
export class LoginDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @MinLength(1, { message: '请输入密码' })
  password: string;
}
