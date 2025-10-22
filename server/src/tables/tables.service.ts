import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, LogAction } from '@prisma/client';

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
      : ['editor', 'exporter', 'admin'] as Role[];
    const created = await this.prisma.table.create({
      data: {
        name: data.name,
        metaJson: (data.metaJson ?? {}) as any,
        exportAllowedRoles: exportRoles as any,
      },
    });
    await this.prisma.log.create({ data: { action: LogAction.create_table, tableId: created.id } });
    return created;
  }

  async update(id: number, data: { name?: string; metaJson?: any; exportAllowedRoles?: Role[] }) {
    const updated = await this.prisma.table.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.metaJson !== undefined ? { metaJson: data.metaJson as any } : {}),
        ...(data.exportAllowedRoles ? { exportAllowedRoles: data.exportAllowedRoles as any } : {}),
        revision: { increment: 1 },
      },
    });
    await this.prisma.log.create({ data: { action: LogAction.update_table, tableId: id } });
    return updated;
  }

  async remove(id: number) {
    await this.prisma.table.delete({ where: { id } });
    await this.prisma.log.create({ data: { action: LogAction.delete_table, tableId: id } });
    return { success: true };
  }
}