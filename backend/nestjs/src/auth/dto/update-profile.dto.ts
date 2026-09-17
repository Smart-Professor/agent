import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 更新资料入参（昵称 / 头像 URL / 全局 AI 头像） */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(32, { message: '昵称最长 32 个字符' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '头像地址过长' })
  avatar?: string;

  /** 全局 AI 头像 URL；显式传 null 清除自定义，回退内置默认头像 */
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'AI 头像地址过长' })
  aiAvatar?: string | null;
}