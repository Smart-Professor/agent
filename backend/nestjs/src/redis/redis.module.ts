import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** 全局 Redis 模块，任何模块均可直接注入 RedisService */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
