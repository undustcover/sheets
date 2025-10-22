import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordsService } from '../records/records.service';
import { LogAction, Role } from '@prisma/client';

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService, private readonly records: RecordsService) {}

  async exportViewCsv(viewId: number, user: { id: number; role: Role }) {
    const view = await this.prisma.view.findUnique({ where: { id: viewId } });
    if (!view) throw new BadRequestException('View not found');
    const table = await this.prisma.table.findUnique({ where: { id: view.tableId } });
    if (!table) throw new BadRequestException('Table not found');

    const allowed: Role[] = (table.exportAllowedRoles as any) || [];
    if (allowed.length && !allowed.includes(user.role)) {
      throw new ForbiddenException('EXPORT_FORBIDDEN');
    }

    const cfg = (view.configJson ?? {}) as any;
    const filters = Array.isArray(cfg.filters) ? cfg.filters : undefined;
    const sort = cfg.sort && cfg.sort.fieldId ? cfg.sort : undefined;

    // Gather all records with current view filters/sort (no pagination for export)
    const size = 100;
    let page = 1;
    let total = 0;
    const all: Array<{ id: number; values: Record<string, any> }> = [];
    // Prime first page to get total
    const first = await this.records.list(view.tableId, { page, size, filters, sort });
    total = first.total;
    all.push(...first.data.map((r: any) => ({ id: r.id, values: r.values })));
    const pages = Math.ceil(total / size);
    for (page = 2; page <= pages; page++) {
      const res = await this.records.list(view.tableId, { page, size, filters, sort });
      all.push(...res.data.map((r: any) => ({ id: r.id, values: r.values })));
    }

    const fields = await this.prisma.field.findMany({ where: { tableId: view.tableId }, orderBy: { id: 'asc' } });
    const headers = fields.map((f) => f.name);
    const fieldIds = fields.map((f) => String(f.id));

    const escape = (val: any) => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') {
        // Escape quotes and wrap in quotes if needed
        const needsQuote = /[",\n]/.test(val);
        const escaped = val.replace(/"/g, '""');
        return needsQuote ? `"${escaped}"` : escaped;
      }
      if (typeof val === 'number' || typeof val === 'boolean') return String(val);
      try {
        const s = JSON.stringify(val);
        const needsQuote = /[",\n]/.test(s);
        const escaped = s.replace(/"/g, '""');
        return needsQuote ? `"${escaped}"` : escaped;
      } catch {
        return '"[object]"';
      }
    };

    const lines: string[] = [];
    lines.push(headers.map((h) => escape(h)).join(','));
    for (const rec of all) {
      const row = fieldIds.map((fid) => escape(rec.values[fid]));
      lines.push(row.join(','));
    }

    const csv = lines.join('\n');

    await this.prisma.log.create({ data: { action: LogAction.export, tableId: view.tableId, viewId: view.id, count: all.length, userId: user.id } });

    const filename = `${this.slug(table.name)}-${this.slug(view.name)}-${this.dateStr()}.csv`;
    return { filename, csv };
  }

  async exportTableCsv(tableId: number, user: { id: number; role: Role }) {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table) throw new BadRequestException('Table not found');

    const allowed: Role[] = (table.exportAllowedRoles as any) || [];
    if (allowed.length && !allowed.includes(user.role)) {
      throw new ForbiddenException('EXPORT_FORBIDDEN');
    }

    // Gather all records for the table (no filters)
    const size = 100;
    let page = 1;
    let total = 0;
    const all: Array<{ id: number; values: Record<string, any> }> = [];
    const first = await this.records.list(tableId, { page, size });
    total = first.total;
    all.push(...first.data.map((r: any) => ({ id: r.id, values: r.values })));
    const pages = Math.ceil(total / size);
    for (page = 2; page <= pages; page++) {
      const res = await this.records.list(tableId, { page, size });
      all.push(...res.data.map((r: any) => ({ id: r.id, values: r.values })));
    }

    const fields = await this.prisma.field.findMany({ where: { tableId }, orderBy: { id: 'asc' } });
    const headers = fields.map((f) => f.name);
    const fieldIds = fields.map((f) => String(f.id));

    const escape = (val: any) => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') {
        const needsQuote = /[",\n]/.test(val);
        const escaped = val.replace(/"/g, '""');
        return needsQuote ? `"${escaped}"` : escaped;
      }
      if (typeof val === 'number' || typeof val === 'boolean') return String(val);
      try {
        const s = JSON.stringify(val);
        const needsQuote = /[",\n]/.test(s);
        const escaped = s.replace(/"/g, '""');
        return needsQuote ? `"${escaped}"` : escaped;
      } catch {
        return '"[object]"';
      }
    };

    const lines: string[] = [];
    lines.push(headers.map((h) => escape(h)).join(','));
    for (const rec of all) {
      const row = fieldIds.map((fid) => escape(rec.values[fid]));
      lines.push(row.join(','));
    }
    const csv = lines.join('\n');

    await this.prisma.log.create({ data: { action: LogAction.export, tableId, count: all.length, userId: user.id } });

    const filename = `${this.slug(table.name)}-${this.dateStr()}.csv`;
    return { filename, csv };
  }

  private slug(s: string) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '')
      .replace(/\-+/g, '-');
  }

  private dateStr() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }
}