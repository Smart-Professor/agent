import { ConfigService } from '@nestjs/config';

export const getRedisConfig = (configService: ConfigService) => ({
  host: configService.get('REDIS_HOST'),
  port: configService.get<number>('REDIS_PORT'),
  password: configService.get('REDIS_PASSWORD'),
});

export const getBullConfig = (configService: ConfigService) => ({
  redis: {
    host: configService.get('REDIS_HOST'),
    port: configService.get<number>('REDIS_PORT'),
    password: configService.get('REDIS_PASSWORD'),
  },
});
