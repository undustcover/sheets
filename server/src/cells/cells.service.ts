import { Injectable, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BatchWriteDto } from './dto/batch-write.dto';
import { FieldType, Prisma } from '@prisma/client';

@Injectable()
export class CellsService {
  constructor(private readonly prisma: PrismaService) {}

  async batchWrite(tableId: number, dto: BatchWriteDto, user: { id: number }) {
    if (!dto.writes || dto.writes.length === 0) {
      throw new BadRequestException('writes required');
    }

    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table) throw new BadRequestException('Table not found');
    if (dto.revision !== table.revision) {
      // 检测具体冲突的单元格
      const conflictDetails = await this.detectConflicts(tableId, dto.writes);
      throw new ConflictException({ 
        message: 'Revision conflict', 
        details: { 
          latestRevision: table.revision,
          conflicts: conflictDetails
        } 
      });
    }

    const recordIds = Array.from(new Set(dto.writes.map((w) => w.recordId))).filter((x) => Number.isFinite(x));
    const fieldIds = Array.from(new Set(dto.writes.map((w) => w.fieldId))).filter((x) => Number.isFinite(x));

    const records = await this.prisma.record.findMany({ where: { id: { in: recordIds }, tableId } });
    const fields = await this.prisma.field.findMany({ where: { id: { in: fieldIds }, tableId } });
    const recordMap = new Map(records.map((r) => [r.id, r]));
    const fieldMap = new Map(fields.map((f) => [f.id, f]));

    for (const w of dto.writes) {
      const rec = recordMap.get(w.recordId);
      const field = fieldMap.get(w.fieldId);
      if (!rec) throw new BadRequestException(`Record not found: ${w.recordId}`);
      if (!field) throw new BadRequestException(`Field not found: ${w.fieldId}`);
      if (rec.readonly) throw new ForbiddenException(`Record ${rec.id} is readonly`);
      if (field.readonly) throw new ForbiddenException(`Field ${field.name} is readonly`);
      if (w.formulaExpr !== undefined && field.type !== FieldType.formula) {
        throw new BadRequestException(`${field.name} is not a formula field`);
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 写入 cell_values
      for (const w of dto.writes) {
        const field = fieldMap.get(w.fieldId)!;
        const { valueJson, formulaExpr, isDirty } = this.validateAndCoerceValue(field, w.value, w.formulaExpr);
        await tx.cellValue.upsert({
          where: { recordId_fieldId: { recordId: w.recordId, fieldId: w.fieldId } },
          update: { valueJson: valueJson as Prisma.InputJsonValue, formulaExpr, isDirty },
          create: { recordId: w.recordId, fieldId: w.fieldId, valueJson: valueJson as Prisma.InputJsonValue, formulaExpr, isDirty },
        });
      }

      // 计算受影响记录的公式
      const affectedRecordIds = recordIds;
      for (const rid of affectedRecordIds) {
        await this.computeFormulas(tx, tableId, rid);
      }

      // 表 revision++
      const updatedTable = await tx.table.update({ where: { id: tableId }, data: { revision: { increment: 1 } } });

      // 审计日志（写入条数）
      await tx.log.create({
        data: { action: 'write_cells', userId: user?.id, tableId, count: dto.writes.length },
      });

      return { revision: updatedTable.revision };
    });

    return { success: true, revision: result.revision, written: dto.writes.length };
  }

  private async detectConflicts(tableId: number, writes: Array<{ recordId: number; fieldId: number; value?: any; formulaExpr?: string }>) {
    const conflicts: Array<{
      recordId: number;
      fieldId: number;
      currentValue: any;
      attemptedValue: any;
      currentFormulaExpr?: string;
      attemptedFormulaExpr?: string;
    }> = [];

    // 获取所有相关的当前单元格值
    const cellKeys = writes.map(w => ({ recordId: w.recordId, fieldId: w.fieldId }));
    const currentCells = await this.prisma.cellValue.findMany({
      where: {
        OR: cellKeys.map(key => ({ recordId: key.recordId, fieldId: key.fieldId }))
      }
    });

    // 获取字段信息用于值验证
    const fieldIds = Array.from(new Set(writes.map(w => w.fieldId)));
    const fields = await this.prisma.field.findMany({ where: { id: { in: fieldIds }, tableId } });
    const fieldMap = new Map(fields.map(f => [f.id, f]));

    const currentCellMap = new Map(
      currentCells.map(cell => [`${cell.recordId}-${cell.fieldId}`, cell])
    );

    for (const write of writes) {
      const cellKey = `${write.recordId}-${write.fieldId}`;
      const currentCell = currentCellMap.get(cellKey);
      const field = fieldMap.get(write.fieldId);
      
      if (!field) continue; // 字段不存在，会在主流程中处理

      // 验证并标准化尝试写入的值
      let attemptedValue: any;
      let attemptedFormulaExpr: string | undefined;
      
      try {
        const { valueJson, formulaExpr } = this.validateAndCoerceValue(field, write.value, write.formulaExpr);
        attemptedValue = valueJson;
        attemptedFormulaExpr = formulaExpr;
      } catch {
        // 如果值验证失败，仍然记录冲突以便前端显示
        attemptedValue = write.value;
        attemptedFormulaExpr = write.formulaExpr;
      }

      // 检查是否存在冲突
      const currentValue = currentCell?.valueJson;
      const currentFormulaExpr = (currentCell?.formulaExpr ?? undefined);

      // 比较值和公式表达式
      const valueChanged = !this.deepEqual(currentValue, attemptedValue);
      const formulaChanged = currentFormulaExpr !== attemptedFormulaExpr;

      if (valueChanged || formulaChanged) {
        conflicts.push({
          recordId: write.recordId,
          fieldId: write.fieldId,
          currentValue,
          attemptedValue,
          currentFormulaExpr,
          attemptedFormulaExpr
        });
      }
    }

    return conflicts;
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }

  private validateAndCoerceValue(field: Prisma.FieldGetPayload<{ include?: {} }>, raw: any, formulaExpr?: string) {
    const opts = (field.optionsJson ?? {}) as any;
    let value: any = raw;
    let isDirty = false;

    switch (field.type) {
      case FieldType.text: {
        if (value === undefined) value = null;
        if (value !== null && typeof value !== 'string') throw new BadRequestException(`${field.name} expects string`);
        const max = opts.maxLength;
        if (typeof max === 'number' && typeof value === 'string' && value.length > max) throw new BadRequestException(`${field.name} exceeds maxLength ${max}`);
        break;
      }
      case FieldType.number: {
        if (value === undefined) value = null;
        if (value !== null && typeof value !== 'number') throw new BadRequestException(`${field.name} expects number`);
        if (typeof value === 'number') {
          if (typeof opts.min === 'number' && value < opts.min) throw new BadRequestException(`${field.name} < min ${opts.min}`);
          if (typeof opts.max === 'number' && value > opts.max) throw new BadRequestException(`${field.name} > max ${opts.max}`);
          if (typeof opts.precision === 'number') {
            const p = Number(opts.precision);
            value = Number((value as number).toFixed(p));
          }
        }
        break;
      }
      case FieldType.boolean: {
        if (value === undefined) value = null;
        if (value !== null && typeof value !== 'boolean') throw new BadRequestException(`${field.name} expects boolean`);
        break;
      }
      case FieldType.select: {
        if (value === undefined) value = null;
        if (value !== null && typeof value !== 'string') throw new BadRequestException(`${field.name} expects string option`);
        const options: string[] = Array.isArray(opts.options) ? opts.options : [];
        if (value !== null && !options.includes(value)) throw new BadRequestException(`${field.name} option not allowed`);
        break;
      }
      case FieldType.multi_select: {
        if (value === undefined) value = null;
        if (value !== null && (!Array.isArray(value) || !value.every((v: any) => typeof v === 'string'))) {
          throw new BadRequestException(`${field.name} expects string[]`);
        }
        const options: string[] = Array.isArray(opts.options) ? opts.options : [];
        if (Array.isArray(value)) for (const v of value) if (!options.includes(v)) throw new BadRequestException(`${field.name} option not allowed: ${v}`);
        break;
      }
      case FieldType.date: {
        if (value === undefined) value = null;
        if (value !== null && typeof value !== 'string') throw new BadRequestException(`${field.name} expects date string`);
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

  private async computeFormulas(tx: Prisma.TransactionClient, tableId: number, recordId: number) {
    const fields = await tx.field.findMany({ where: { tableId } });
    const fieldById = new Map(fields.map((f) => [f.id, f]));
    const cells = await tx.cellValue.findMany({ where: { recordId } });
    const byFieldId = new Map(cells.map((c) => [c.fieldId, c]));

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
        value = Number((value as number).toFixed(Number(opts.precision)));
      }

      await tx.cellValue.upsert({
        where: { recordId_fieldId: { recordId, fieldId: f.id } },
        update: { valueJson: value as Prisma.InputJsonValue, computedAt: new Date(), isDirty: false },
        create: { recordId, fieldId: f.id, valueJson: value as Prisma.InputJsonValue, computedAt: new Date(), isDirty: false },
      });
    }
  }

  private safeEval(expr: string, ctx: Record<string, number>): number | null {
    const replaced = expr.replace(/[A-Za-z0-9_]+/g, (m) => (Object.prototype.hasOwnProperty.call(ctx, m) ? String(ctx[m]) : m));
    if (!/^[-+*/()0-9.\s]+$/.test(replaced)) return null;
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return (${replaced})`);
      const r = fn();
      return typeof r === 'number' && Number.isFinite(r) ? r : null;
    } catch {
      return null;
    }
  }
}