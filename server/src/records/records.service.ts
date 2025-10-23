import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FieldType, Prisma } from '@prisma/client';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateRecordDto } from './dto/update-record.dto';

@Injectable()
export class RecordsService {
  constructor(private prisma: PrismaService) {}

  async list(
    tableId: number,
    params?: { page?: number; size?: number; filters?: Array<{ fieldId: number; op: string; value?: any }>; sort?: { fieldId: number; direction: 'asc'|'desc' } },
  ) {
    const page = Math.max(1, params?.page ?? 1);
    const size = Math.max(1, Math.min(100, params?.size ?? 20));

    // 读取所有记录与其值（MVP：内存过滤/排序）
    const records = await this.prisma.record.findMany({ where: { tableId }, orderBy: { id: 'asc' } });
    const ids = records.map((r) => r.id);
    const fields = await this.prisma.field.findMany({ where: { tableId } });
    const fieldMap = new Map(fields.map((f) => [String(f.id), f]));

    const valuesByRecord: Record<number, Record<string, any>> = {};
    if (ids.length) {
      const cells = await this.prisma.cellValue.findMany({ where: { recordId: { in: ids } }, orderBy: { recordId: 'asc' } });
      for (const c of cells) {
        const m = (valuesByRecord[c.recordId] ??= {});
        m[String(c.fieldId)] = c.valueJson as any;
      }
    }

    // 过滤
    let filtered = records;
    const filters = params?.filters ?? [];
    if (filters.length) {
      filtered = records.filter((r) => {
        const vals = valuesByRecord[r.id] ?? {};
        for (const f of filters) {
          const field = fieldMap.get(String(f.fieldId));
          if (!field) return false;
          const v = vals[String(f.fieldId)];
          const op = f.op;
          const cmp = (a: any, b: any) => {
            if (a === undefined || a === null) return false;
            switch (op) {
              case 'eq': return a === b;
              case 'ne': return a !== b;
              case 'lt': return a < b;
              case 'lte': return a <= b;
              case 'gt': return a > b;
              case 'gte': return a >= b;
              case 'contains': return typeof a === 'string' && typeof b === 'string' && a.includes(b);
              case 'in': return Array.isArray(b) && b.includes(a);
              case 'between': return Array.isArray(b) && b.length === 2 && a >= b[0] && a <= b[1];
              case 'is_null': return a === null || a === undefined;
              case 'is_not_null': return !(a === null || a === undefined);
              default: return true;
            }
          };
          if (!cmp(v, f.value)) return false;
        }
        return true;
      });
    }

    // 排序
    const sort = params?.sort;
    if (sort && sort.fieldId) {
      const dir = sort.direction === 'desc' ? -1 : 1;
      filtered = filtered.slice().sort((a, b) => {
        const av = (valuesByRecord[a.id] ?? {})[String(sort.fieldId)];
        const bv = (valuesByRecord[b.id] ?? {})[String(sort.fieldId)];
        if (av == null && bv == null) return a.id - b.id; // 稳定：按ID兜底
        if (av == null) return -1 * dir;
        if (bv == null) return 1 * dir;
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return a.id - b.id; // 值相等时按ID稳定排序
      });
    }

    const total = filtered.length;
    const start = (page - 1) * size;
    const paged = filtered.slice(start, start + size);
    const data = paged.map((r) => ({ ...r, values: valuesByRecord[r.id] ?? {} }));

    return { data, page, size, total };
  }

  async get(tableId: number, id: number) {
    const rec = await this.prisma.record.findFirst({ where: { tableId, id } });
    if (!rec) throw new BadRequestException('Record not found');

    const cells = await this.prisma.cellValue.findMany({ where: { recordId: id } });
    const values: Record<string, any> = {};
    for (const c of cells) values[String(c.fieldId)] = c.valueJson as any;

    return { ...rec, values };
  }

  async create(tableId: number, dto: CreateRecordDto) {
    const fields = await this.prisma.field.findMany({ where: { tableId } });
    const fieldMap = new Map(fields.map((f) => [String(f.id), f]));
  
    // 基本校验
    if (!dto.values || typeof dto.values !== 'object') {
      throw new BadRequestException('values object is required');
    }
  
    // 创建记录
    const record = await this.prisma.record.create({
      data: {
        tableId,
        readonly: dto.readonly ?? false,
        metaJson: dto.metaJson ?? {},
      },
    });
  
    // 为每个输入值创建对应的 CellValue
    for (const [key, raw] of Object.entries(dto.values)) {
      const field = fieldMap.get(String(key));
      if (!field) {
        throw new BadRequestException(`Unknown fieldId: ${key}`);
      }
      if (field.readonly) {
        throw new ForbiddenException(`Field ${field.name} is readonly`);
      }
  
      const { valueJson, formulaExpr, isDirty } = this.validateAndCoerceValue(field, raw, dto.formulas?.[String(key)]);
  
      await this.prisma.cellValue.create({
        data: {
          recordId: record.id,
          fieldId: field.id,
          valueJson,
          formulaExpr,
          isDirty,
        },
      });
    }
  
    // 新增：创建后同步计算所有公式字段
    await this.computeFormulas(tableId, record.id);
  
    return record;
  }

  async update(tableId: number, id: number, dto: UpdateRecordDto) {
    const rec = await this.prisma.record.findFirst({ where: { tableId, id } });
    if (!rec) throw new BadRequestException('Record not found');
    if (
      rec.readonly &&
      (dto.metaJson !== undefined || dto.readonly !== undefined || dto.values !== undefined || dto.formulas !== undefined)
    ) {
      throw new ForbiddenException('Record is readonly');
    }
  
    const updated = await this.prisma.record.update({
      where: { id },
      data: {
        ...(dto.readonly !== undefined ? { readonly: dto.readonly } : {}),
        ...(dto.metaJson !== undefined ? { metaJson: dto.metaJson as Prisma.InputJsonValue } : {}),
      },
    });
  
    if (dto.values !== undefined || dto.formulas !== undefined) {
      const fields = await this.prisma.field.findMany({ where: { tableId } });
      const fieldMap = new Map(fields.map((f) => [String(f.id), f]));
  
      const keys = new Set([
        ...Object.keys(dto.values ?? {}),
        ...Object.keys(dto.formulas ?? {}),
      ]);
  
      for (const key of keys) {
        const field = fieldMap.get(String(key));
        if (!field) throw new BadRequestException(`Unknown fieldId: ${key}`);
        if (field.readonly) throw new ForbiddenException(`Field ${field.name} is readonly`);
  
        const raw = dto.values?.[String(key)];
        const formulaExpr = dto.formulas?.[String(key)];
        if (formulaExpr !== undefined && field.type !== FieldType.formula) {
          throw new BadRequestException(`${field.name} is not a formula field`);
        }
  
        const { valueJson, formulaExpr: fe, isDirty } = this.validateAndCoerceValue(field, raw, formulaExpr);
  
        await this.prisma.cellValue.upsert({
          where: { recordId_fieldId: { recordId: id, fieldId: field.id } },
          update: { valueJson: valueJson as Prisma.InputJsonValue, formulaExpr: fe, isDirty },
          create: { recordId: id, fieldId: field.id, valueJson: valueJson as Prisma.InputJsonValue, formulaExpr: fe, isDirty },
        });
      }
  
      // 新增：更新后同步计算所有公式字段
      await this.computeFormulas(tableId, id);
    }
  
    return updated;
  }

  async remove(tableId: number, id: number) {
    const rec = await this.prisma.record.findFirst({ where: { tableId, id } });
    if (!rec) throw new BadRequestException('Record not found');
    await this.prisma.record.delete({ where: { id } });
    return { success: true };
  }

  private validateAndCoerceValue(field: Prisma.FieldGetPayload<{ include?: {} }>, raw: any, formulaExpr?: string) {
    const opts = (field.optionsJson ?? {}) as any;
    let value: any = raw;
    let isDirty = false;
  
    switch (field.type) {
      case FieldType.text: {
        if (typeof value !== 'string') throw new BadRequestException(`${field.name} expects string`);
        const max = opts.maxLength;
        if (typeof max === 'number' && value.length > max) throw new BadRequestException(`${field.name} exceeds maxLength ${max}`);
        break;
      }
      case FieldType.number: {
        if (typeof value !== 'number') throw new BadRequestException(`${field.name} expects number`);
        if (typeof opts.min === 'number' && value < opts.min) throw new BadRequestException(`${field.name} < min ${opts.min}`);
        if (typeof opts.max === 'number' && value > opts.max) throw new BadRequestException(`${field.name} > max ${opts.max}`);
        if (typeof opts.precision === 'number') {
          const p = Number(opts.precision);
          const fixed = Number(value.toFixed(p));
          value = fixed;
        }
        break;
      }
      case FieldType.boolean: {
        if (typeof value !== 'boolean') throw new BadRequestException(`${field.name} expects boolean`);
        break;
      }
      case FieldType.select: {
        if (typeof value !== 'string') throw new BadRequestException(`${field.name} expects string option`);
        const options: string[] = Array.isArray(opts.options) ? opts.options : [];
        if (!options.includes(value)) throw new BadRequestException(`${field.name} option not allowed`);
        break;
      }
      case FieldType.multi_select: {
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          throw new BadRequestException(`${field.name} expects string[]`);
        }
        const options: string[] = Array.isArray(opts.options) ? opts.options : [];
        for (const v of value) if (!options.includes(v)) throw new BadRequestException(`${field.name} option not allowed: ${v}`);
        break;
      }
      case FieldType.date: {
        if (typeof value !== 'string') throw new BadRequestException(`${field.name} expects date string`);
        // 轻校验：ISO-like 或格式由前端保证；此处仅存储字符串
        break;
      }
      case FieldType.attachment: {
        // 允许数组或对象，细校验在附件模块；此处直接存储
        break;
      }
      case FieldType.formula: {
        // 公式字段：忽略 value，保存 formulaExpr 并标记需要计算
        value = null;
        isDirty = true;
        if (typeof formulaExpr !== 'string' || !formulaExpr.trim()) {
          throw new BadRequestException(`${field.name} requires formula expression`);
        }
        break;
      }
      default:
        throw new BadRequestException(`Unsupported field type: ${field.type}`);
    }
  
    return { valueJson: value as any, formulaExpr, isDirty };
  }

  // 新增：轻量级公式计算（仅支持 + - * / 与字段名/字段ID）
  private async computeFormulas(tableId: number, recordId: number) {
    const fields = await this.prisma.field.findMany({ where: { tableId } });
    const fieldById = new Map(fields.map((f) => [f.id, f]));
    const cells = await this.prisma.cellValue.findMany({ where: { recordId } });
    const byFieldId = new Map(cells.map((c) => [c.fieldId, c]));
  
    // 构建上下文：字段名与字段ID可引用的数值
    const ctx: Record<string, number> = {};
    for (const c of cells) {
      const f = fieldById.get(c.fieldId);
      if (!f) continue;
      if (f.type === FieldType.number && typeof (c.valueJson as any) === 'number') {
        ctx[f.name] = c.valueJson as any;
        ctx[String(f.id)] = c.valueJson as any;
      }
    }
  
    for (const f of fields) {
      if (f.type !== FieldType.formula) continue;
      const cell = byFieldId.get(f.id);
      const expr = cell?.formulaExpr;
      if (!expr || typeof expr !== 'string') continue;
  
      const result = this.safeEval(expr, ctx);
      let value: any = result;
      const opts = (f.optionsJson ?? {}) as any;
      if (typeof value === 'number' && typeof opts.precision === 'number') {
        value = Number(value.toFixed(Number(opts.precision)));
      }
  
      await this.prisma.cellValue.upsert({
        where: { recordId_fieldId: { recordId, fieldId: f.id } },
        update: { valueJson: value as Prisma.InputJsonValue, computedAt: new Date(), isDirty: false },
        create: { recordId, fieldId: f.id, valueJson: value as Prisma.InputJsonValue, computedAt: new Date(), isDirty: false },
      });
    }
  }
  
  private safeEval(expr: string, ctx: Record<string, number>): number | null {
    // 只允许变量名、数字、空白与 + - * / ()
    // 将变量名替换为对应数值，未知变量将导致表达式不合法
    const varRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
    let ok = true;
    const substituted = expr.replace(varRegex, (name) => {
      if (Object.prototype.hasOwnProperty.call(ctx, name)) {
        const v = ctx[name];
        if (typeof v !== 'number' || Number.isNaN(v)) { ok = false; return 'NaN'; }
        return String(v);
      }
      ok = false;
      return 'NaN';
    });
  
    if (!/^[0-9+\-*/().\sNaN]+$/.test(substituted)) return null;
    if (!ok) return null;
    try {
      // 安全前提下计算
      const fn = new Function(`return (${substituted})`);
      const r = fn();
      if (typeof r === 'number' && Number.isFinite(r)) return r;
      return null;
    } catch {
      return null;
    }
  }
}