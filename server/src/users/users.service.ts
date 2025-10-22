import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.user.findMany({
      select: { id: true, username: true, role: true, createdAt: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
  }

  async create(data: { username: string; password: string; role: Role }) {
    const passwordHash = await argon2.hash(data.password);
    const user = await this.prisma.user.create({
      data: { username: data.username, password: passwordHash, role: data.role },
      select: { id: true, username: true, role: true, createdAt: true, updatedAt: true },
    });
    return user;
  }

  async update(id: number, data: { password?: string; role?: Role }) {
    const updateData: { password?: string; role?: Role } = {};
    if (data.password) {
      updateData.password = await argon2.hash(data.password);
    }
    if (data.role) {
      updateData.role = data.role;
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, username: true, role: true, createdAt: true, updatedAt: true },
    });
    return user;
  }

  async remove(id: number) {
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }
}