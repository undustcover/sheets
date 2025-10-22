import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

export type UserPayload = { id: number; username: string; role: 'viewer'|'editor'|'exporter'|'admin' };

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService, private readonly prisma: PrismaService) {}

  async validateUser(username: string, password: string): Promise<UserPayload | null> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) return null;
    const ok = await argon2.verify(user.password, password);
    if (!ok) return null;
    return { id: user.id, username: user.username, role: user.role } as UserPayload;
  }

  async login(username: string, password: string) {
    const user = await this.validateUser(username, password);
    if (!user) {
      return { code: 'AUTH_FAILED', message: '用户名或密码错误' };
    }
    const token = await this.jwtService.signAsync({ sub: user.id, username: user.username, role: user.role });
    return { token, user };
  }
}