import { SetMetadata } from '@nestjs/common';

/** 公开路由标记键 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记接口为公开接口（免登录）
 * 全局 JwtAuthGuard 会放行带此标记的路由
 * 用法：@Public() 标注在 Controller 方法或类上
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);