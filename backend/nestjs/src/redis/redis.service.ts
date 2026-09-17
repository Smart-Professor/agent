import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis 基础服务：封装常用字符串操作
 * 主要用于验证码存储（带 TTL）与发送频控
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST'),
      port: Number(this.config.get<number>('REDIS_PORT')),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 500, 3000),
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis 连接异常: ${err.message}`);
    });
  }

  /** 读取字符串值 */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** 写入字符串值（无过期时间） */
  async set(key: string, value: string): Promise<'OK'> {
    return this.client.set(key, value);
  }

  /** 写入字符串值并设置过期时间（秒） */
  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    return this.client.set(key, value, 'EX', seconds);
  }

  /** 删除 key，返回被删除的数量 */
  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  /** key 是否存在（1 存在 / 0 不存在） */
  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  /** 剩余过期时间（秒），-1 永不过期，-2 不存在 */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
