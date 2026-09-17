import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** 消息附件入参（图片/文档/音频；文档类的文本由上传接口提取好） */
export class MessageAttachmentDto {
  @IsIn(['image', 'file', 'audio'], { message: '附件类型仅支持 image / file / audio' })
  type: 'image' | 'file' | 'audio';

  @IsUrl({ require_tld: false }, { message: '附件 URL 格式不正确' })
  @MaxLength(1000, { message: '附件 URL 过长' })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '附件文件名过长' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '附件 MIME 过长' })
  mime?: string;

  @IsOptional()
  @IsInt({ message: '附件大小格式不正确' })
  size?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50000, { message: '附件提取文本过长' })
  text?: string;
}

/** 发送对话消息入参 */
export class SendMessageDto {
  /** 会话 ID（首次发送时为空，服务端自动创建会话并通过 SSE 元事件返回） */
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsString()
  @MinLength(1, { message: '消息内容不能为空' })
  @MaxLength(8000, { message: '消息内容过长' })
  content: string;

  /** 本次发送使用的模型 ID（会话已保存模型时以此为准；不传则用会话已存值或默认） */
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '模型 ID 过长' })
  @Matches(/^[\w.:-]+$/, { message: '模型 ID 格式不正确' })
  model?: string;

  /** Agent 模式：不传或 chat=普通对话；character_design=角色设计智能体 */
  @IsOptional()
  @IsIn(['chat', 'character_design'], { message: 'mode 仅支持 chat / character_design' })
  mode?: 'chat' | 'character_design';

  /** 随消息携带的多模态附件（需先调用 /chat/attachments 上传） */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}
