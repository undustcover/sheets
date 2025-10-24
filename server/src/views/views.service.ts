import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogAction, ViewType } from '@prisma/client';
import { RecordsService } from '../records/records.service';

@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService, private readonly records: RecordsService) {}

  async list(tableId: number) {
    return this.prisma.view.findMany({ where: { tableId }, orderBy: { id: 'asc' } });
  }

  async get(tableId: number, id: number) {
    return this.prisma.view.findFirst({ where: { id, tableId } });
  }

  async create(tableId: number, data: { name: string; type: ViewType; configJson?: any; anonymousEnabled?: boolean }) {
    const created = await this.prisma.view.create({
      data: {
        tableId,
        name: data.name,
        type: data.type,
        configJson: (data.configJson ?? {}) as any,
        anonymousEnabled: data.anonymousEnabled ?? false,
      },
    });
    await this.prisma.log.create({ data: { action: LogAction.create_view, tableId, viewId: created.id } });
    return created;
  }

  async update(id: number, data: { name?: string; type?: ViewType; configJson?: any; anonymousEnabled?: boolean }) {
    const current = await this.prisma.view.findUnique({ where: { id } });
    if (!current) throw new BadRequestException('View not found');
    const updated = await this.prisma.view.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.configJson !== undefined ? { configJson: data.configJson as any } : {}),
        ...(data.anonymousEnabled !== undefined ? { anonymousEnabled: data.anonymousEnabled } : {}),
        revision: { increment: 1 },
      },
    });
    await this.prisma.log.create({ data: { action: LogAction.update_view, tableId: current.tableId, viewId: id } });
    return updated;
  }

  async remove(id: number) {
    const current = await this.prisma.view.findUnique({ where: { id } });
    if (!current) throw new BadRequestException('View not found');
    await this.prisma.view.delete({ where: { id } });
    await this.prisma.log.create({ data: { action: LogAction.delete_view, tableId: current.tableId, viewId: id } });
    return { success: true };
  }

  async getData(viewId: number, params?: { page?: number; size?: number; filters?: Array<{ fieldId: number; op: string; value?: any }>; sort?: { fieldId: number; direction: 'asc'|'desc' } }, allowAnonymous = false) {
    const view = await this.prisma.view.findUnique({ where: { id: viewId } })
    if (!view) throw new BadRequestException('View not found')
    // 同时校验视图与表的匿名授权
    if (allowAnonymous) {
      if (!view.anonymousEnabled) {
        throw new UnauthorizedException('ANONYMOUS_DISABLED')
      }
      const table = await this.prisma.table.findUnique({ where: { id: view.tableId } })
      if (!table) throw new BadRequestException('Table not found')
      console.log('[ViewsService.getData] anon-check', { viewId, allowAnonymous, viewAnon: view.anonymousEnabled, tableAnon: (table as any)?.anonymousEnabled })
      if (!(table as any).anonymousEnabled) {
        throw new UnauthorizedException('TABLE_ANONYMOUS_DISABLED')
      }
    }

    const cfg = (view.configJson ?? {}) as any
    const mergedFilters = params?.filters ?? (Array.isArray(cfg.filters) ? cfg.filters : undefined)
    const mergedSort = params?.sort ?? (cfg.sort && cfg.sort.fieldId ? cfg.sort : undefined)
    const page = params?.page ?? cfg.page ?? 1
    const size = params?.size ?? cfg.size ?? 20

    const result = await this.records.list(view.tableId, {
      page,
      size,
      filters: mergedFilters,
      sort: mergedSort,
    })

    // 附带字段元数据，便于匿名模式前端渲染列头与类型
    const fields = await this.prisma.field.findMany({
      where: { tableId: view.tableId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, type: true, readonly: true },
    })

    return { view: { id: view.id, tableId: view.tableId, name: view.name, type: view.type, revision: view.revision, configJson: (view.configJson ?? {}) as any }, fields, ...result }
  }
}