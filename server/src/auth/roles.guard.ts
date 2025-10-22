import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: Role } | undefined;
    if (!user || !user.role) {
      throw new ForbiddenException('需要认证并具备相应角色');
    }
    const ok = required.includes(user.role);
    if (!ok) {
      throw new ForbiddenException(`需要角色：${required.join('/')}`);
    }
    return true;
  }
}