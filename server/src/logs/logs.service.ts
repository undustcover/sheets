import { Injectable } from '@nestjs/common';
import { Prisma, LogAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ListLogsParams = {
  page?: number;
  size?: number;
  action?: LogAction | string;
  userId?: number;
  tableId?: number;
  viewId?: number;
};

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListLogsParams) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const size = params.size && params.size > 0 && params.size <= 200 ? params.size : 50;

    const where: Prisma.LogWhereInput = {};

    if (params.action && typeof params.action === 'string') {
      // Coerce to enum if valid; else ignore filter
      const a = String(params.action).trim();
      if ((Object.values(LogAction) as string[]).includes(a)) {
        where.action = a as LogAction;
      }
    }
    if (typeof params.userId === 'number') where.userId = params.userId;
    if (typeof params.tableId === 'number') where.tableId = params.tableId;
    if (typeof params.viewId === 'number') where.viewId = params.viewId;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.log.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.log.count({ where }),
    ]);

    return { data, page, size, total };
  }
}