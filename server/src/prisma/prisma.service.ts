import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
    await this.ensureAdminSeed();
  }

  private async ensureAdminSeed() {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    const roleEnv = (process.env.ADMIN_ROLE || 'admin').toLowerCase();

    if (!username || !password) return;

    const role: Role = ['viewer','editor','exporter','admin'].includes(roleEnv)
      ? (roleEnv as Role)
      : 'admin';

    const hash = await argon2.hash(password);
    // 使用 upsert 避免并发导致的唯一约束冲突
    await this.user.upsert({
      where: { username },
      update: { password: hash, role },
      create: { username, password: hash, role },
    });
    // 可扩展：写入审计日志 Log(action=login) 等
  }
}