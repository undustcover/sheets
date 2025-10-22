import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.table.findMany({
      orderBy: { id: 'asc' },
    });
  }

  async get(id: number) {
    return this.prisma.table.findUnique({ where: { id } });
  }

  async create(data: { name: string; metaJson?: any; exportAllowedRoles?: Role[] }) {
    const exportRoles = data.exportAllowedRoles && data.exportAllowedRoles.length > 0
      ? data.exportAllowedRoles
      : ['editor', 'exporter', 'admin'];
    const created = await this.prisma.table.create({
      data: {
        name: data.name,
        metaJson: data.metaJson ?? {},
        exportAllowedRoles: exportRoles,
      },
    });
    return created;
  }

  async update(id: number, data: { name?: string; metaJson?: any; exportAllowedRoles?: Role[] }) {
    const updated = await this.prisma.table.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.metaJson !== undefined ? { metaJson: data.metaJson } : {}),
        ...(data.exportAllowedRoles ? { exportAllowedRoles: data.exportAllowedRoles } : {}),
        revision: { increment: 1 },
      },
    });
    return updated;
  }

  async remove(id: number) {
    await this.prisma.table.delete({ where: { id } });
    return { success: true };
  }
}