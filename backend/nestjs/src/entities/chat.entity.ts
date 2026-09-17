import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** AI 对话会话：每个用户可拥有多个会话 */
@Entity('chat_conversations')
export class ChatConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  title: string;

  /** 本会话专属 AI 头像（R2 公开 URL）；为空时回退到用户的全局默认 AI 头像 */
  @Column({ type: 'varchar', nullable: true })
  aiAvatar: string | null;

  /** 本会话使用的模型 ID；为空时 Python 侧使用 .env 默认模型 */
  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** 消息附件：图片 / 文档 / 音频（URL 指向 R2，文档类附带提取的文本） */
export interface MessageAttachment {
  type: 'image' | 'file' | 'audio';
  url: string;
  name?: string;
  mime?: string;
  size?: number;
  /** 文档附件的服务端提取文本（发给模型做上下文） */
  text?: string;
}

/** AI 对话消息：属于某个会话，role 为 user / assistant */
@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId: string;

  @Column({ type: 'varchar', length: 10 })
  role: 'user' | 'assistant';

  @Column({ type: 'text' })
  content: string;

  /** 多模态附件列表（jsonb）；无附件时为 null */
  @Column({ type: 'jsonb', nullable: true })
  attachments: MessageAttachment[] | null;

  @CreateDateColumn()
  createdAt: Date;
}