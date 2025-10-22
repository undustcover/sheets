import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordsService } from '../records/records.service';
import { FieldType, LogAction, Role } from '@prisma/client';

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService, private readonly records: RecordsService) {}

  async importCsv(tableId: number, user: { id: number; role: Role }, file: Express.Multer.File) {
    if (!file || !file.buffer) throw new BadRequestException('缺少CSV文件或内容为空');

    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table) throw new BadRequestException('Table not found');

    // 权限：编辑者、管理员允许导入（后续可扩展单独 importAllowedRoles）
    const allowed: Role[] = ['editor', 'admin'] as any;
    if (!allowed.includes(user.role)) throw new ForbiddenException('IMPORT_FORBIDDEN');

    const fields = await this.prisma.field.findMany({ where: { tableId }, orderBy: { id: 'asc' } });
    const byName = new Map(fields.map((f) => [f.name, f]));
    const byIdStr = new Map(fields.map((f) => [String(f.id), f]));

    const text = file.buffer.toString('utf8');
    const rows = this.parseCsv(text);
    if (rows.length === 0) throw new BadRequestException('CSV内容为空');

    const header = rows[0];
    const body = rows.slice(1);

    // 映射：优先匹配字段名；其次匹配字段ID字符串；未知列忽略
    const headerMap: Array<{ field: typeof fields[number] | null; index: number }> = header.map((h, i) => {
      const byN = byName.get(h);
      if (byN) return { field: byN, index: i };
      const byI = byIdStr.get(h);
      if (byI) return { field: byI, index: i };
      return { field: null, index: i };
    });

    let createdCount = 0;
    for (const row of body) {
      const values: Record<string, any> = {};
      // 公式字段暂不从CSV导入公式表达式；仅导入常规类型值
      for (const { field, index } of headerMap) {
        if (!field) continue;
        const raw = row[index] ?? '';
        const v = this.coerceValue(field, raw);
        // 跳过无法解析的值（可选）
        if (v === undefined) continue;
        values[String(field.id)] = v;
      }
      if (Object.keys(values).length === 0) continue;

      await this.records.create(tableId, { values });
      createdCount++;
    }

    await this.prisma.log.create({ data: { action: LogAction.import, tableId, userId: user.id, count: createdCount } });
    return { count: createdCount };
  }

  private coerceValue(field: { type: FieldType; optionsJson: any }, raw: string): any {
    const trimmed = (raw ?? '').trim();
    switch (field.type) {
      case FieldType.text:
        return trimmed;
      case FieldType.number: {
        if (trimmed.length === 0) return undefined;
        const n = Number(trimmed);
        if (Number.isNaN(n)) return undefined;
        const opts = (field.optionsJson ?? {}) as any;
        if (typeof opts.precision === 'number') return Number(n.toFixed(Number(opts.precision)));
        return n;
      }
      case FieldType.boolean: {
        if (/^(true|1)$/i.test(trimmed)) return true;
        if (/^(false|0)$/i.test(trimmed)) return false;
        return undefined;
      }
      case FieldType.date: {
        // 轻量：按字符串存储，留给前端/后续严格校验
        return trimmed.length ? trimmed : undefined;
      }
      case FieldType.select: {
        const val = trimmed;
        const options: string[] = Array.isArray((field.optionsJson ?? {}).options) ? (field.optionsJson as any).options : [];
        if (!val) return undefined;
        if (options.length && !options.includes(val)) return undefined;
        return val;
      }
      case FieldType.multi_select: {
        if (!trimmed) return undefined;
        // 默认分隔符为分号；可扩展配置
        const parts = trimmed.split(';').map((x) => x.trim()).filter((x) => x.length > 0);
        const options: string[] = Array.isArray((field.optionsJson ?? {}).options) ? (field.optionsJson as any).options : [];
        if (options.length && parts.some((p) => !options.includes(p))) return undefined;
        return parts;
      }
      case FieldType.attachment: {
        // 不支持直接从CSV导入附件
        return undefined;
      }
      case FieldType.formula: {
        // 公式值由系统计算，不接受CSV值
        return undefined;
      }
      default:
        return undefined;
    }
  }

  // 简易CSV解析，支持双引号与逗号
  private parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let i = 0;
    const len = text.length;
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    while (i < len) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i++;
            continue;
          }
        } else {
          field += ch;
          i++;
          continue;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
          continue;
        }
        if (ch === ',') {
          row.push(field);
          field = '';
          i++;
          continue;
        }
        if (ch === '\n') {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
          i++;
          continue;
        }
        if (ch === '\r') { // handle CRLF
          i++;
          continue;
        }
        field += ch;
        i++;
      }
    }
    // flush last field/row
    row.push(field);
    rows.push(row);
    return rows.filter((r) => r.length && !(r.length === 1 && r[0].trim().length === 0));
  }
}