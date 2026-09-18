import { resolve } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { R2Module } from './r2/r2.module';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './mail/mail.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { getDatabaseConfig } from './config/database.config';
import { getBullConfig } from './config/redis.config';

@Module({
  imports: [
    // 全项目唯一的 .env 在仓库根目录；本服务需从 backend/nestjs 目录启动（npm run start:dev），
    // cwd 即本目录，据此向上定位根 .env
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(process.cwd(), '../../.env'),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getBullConfig,
    }),
    RedisModule,
    MailModule,
    UsersModule,
    AuthModule,
    ChatModule,
    R2Module,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
