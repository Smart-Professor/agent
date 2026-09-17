import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 设置/清除会话专属 AI 头像入参；aiAvatar 显式传 null 表示清除，回退全局默认 */
export class UpdateAiAvatarDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'AI 头像地址过长' })
  aiAvatar?: string | null;
}
