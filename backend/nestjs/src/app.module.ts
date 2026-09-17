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
    ConfigModule.forRoot({ isGlobal: true }),
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
