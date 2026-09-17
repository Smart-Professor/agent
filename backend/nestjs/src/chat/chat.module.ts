import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatConversation, ChatMessage } from '../entities/chat.entity';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { R2Module } from '../r2/r2.module';

@Module({
  // R2Module：会话级 AI 头像上传到 R2
  imports: [TypeOrmModule.forFeature([ChatConversation, ChatMessage]), R2Module],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}