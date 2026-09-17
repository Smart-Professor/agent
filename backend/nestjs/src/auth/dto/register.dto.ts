import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/** 注册入参 */
export class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @Length(6, 64, { message: '密码长度需在 6-64 位之间' })
  password: string;

  @Matches(/^\d{6}$/, { message: '验证码为 6 位数字' })
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;
}
