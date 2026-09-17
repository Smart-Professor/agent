import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** 设置会话使用模型入参；null/空表示回退默认模型 */
export class UpdateModelDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '模型 ID 过长' })
  @Matches(/^[\w.:-]+$/, { message: '模型 ID 格式不正确' })
  model?: string | null;
}
