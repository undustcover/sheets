import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from '@nestjs/common';

// 简易内存限流（每 IP + 路径）：windowSeconds 内最多 allow 次
@Injectable()
export class RateLimitGuard implements CanActivate {
  private static store = new Map<string, number[]>();
  private static windowSeconds = Number(process.env.RATE_LIMIT_WINDOW_SEC ?? 60);
  private static allow = Number(process.env.RATE_LIMIT_MAX ?? 5);

  canActivate(context: ExecutionContext): boolean {
    // 开发环境默认关闭限流，或通过环境变量显式关闭
    const isDev = (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') || !process.env.NODE_ENV;
    const disabled = process.env.RATE_LIMIT_DISABLED === '1';
    if (isDev || disabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const ip = this.extractIp(request);
    const key = `${ip}:${request.path || request.url || ''}`;
    const now = Date.now();
    const windowMs = RateLimitGuard.windowSeconds * 1000;

    const arr = RateLimitGuard.store.get(key) ?? [];
    // 清理过期的时间戳
    const fresh = arr.filter((ts) => now - ts < windowMs);
    fresh.push(now);
    RateLimitGuard.store.set(key, fresh);

    if (fresh.length > RateLimitGuard.allow) {
      // 生产环境：不返回 429，改为 403，并提示友好文案
      throw new HttpException('1分钟内只能登录5次', HttpStatus.FORBIDDEN);
    }
    return true;
  }

  private extractIp(req: any): string {
    const xfwd = (req.headers?.['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const ip = xfwd || req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    return ip;
  }
}