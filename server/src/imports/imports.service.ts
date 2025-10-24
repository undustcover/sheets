import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordsService } from '../records/records.service';
import { FieldType, LogAction, Role } from '@prisma/client';

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService, private readonly records: RecordsService) {}

  // 进度寄存（按表维度）；后续可升级为任务ID
  private progressByTable = new Map<number, { status: 'idle' | 'validating' | 'inserting' | 'done' | 'error'; total: number; processed: number; percent: number; message?: string; startedAt?: number; finishedAt?: number }>();
  // 最近一次失败报告（按表维度），来源可能是 dryRun 校验失败或实际导入失败
  private lastFailureByTable = new Map<number, {
    generatedAt: number;
    source: 'dryRun' | 'import';
    hasHeader: boolean;
    delimiter: string;
    totalRows: number;
    failedCount: number;
    headers: string[];
    rows: Array<{ rowIndex: number; values: Record<string, any>; errors: string[] }>
  }>();

  getProgress(tableId: number) {
    const p = this.progressByTable.get(tableId);
    return (
      p || { status: 'idle', total: 0, processed: 0, percent: 0, message: undefined }
    );
  }

  private setProgress(tableId: number, patch: Partial<{ status: 'idle' | 'validating' | 'inserting' | 'done' | 'error'; total: number; processed: number; percent: number; message?: string; startedAt?: number; finishedAt?: number }>) {
    const prev = this.progressByTable.get(tableId) || { status: 'idle', total: 0, processed: 0, percent: 0 } as any;
    const next = { ...prev, ...patch } as typeof prev;
    this.progressByTable.set(tableId, next);
  }

  getLastFailureReport(tableId: number) {
    return this.lastFailureByTable.get(tableId);
  }
  private setLastFailureReport(tableId: number, report: {
    generatedAt: number;
    source: 'dryRun' | 'import';
    hasHeader: boolean;
    delimiter: string;
    totalRows: number;
    failedCount: number;
    headers: string[];
    rows: Array<{ rowIndex: number; values: Record<string, any>; errors: string[] }>
  } | null) {
    if (report && report.failedCount > 0) {
      this.lastFailureByTable.set(tableId, report);
    } else {
      this.lastFailureByTable.delete(tableId);
    }
  }

  async importCsv(
    tableId: number,
    user: { id: number; role: Role },
    file: Express.Multer.File,
    opts?: {
      delimiter?: string;
      encoding?: string;
      hasHeader?: boolean;
      mapping?: Record<number, number>;
      ignoreUnknownColumns?: boolean;
      dryRun?: boolean;
      rollbackOnError?: boolean;
    },
  ) {
    if (!file || !file.buffer) throw new BadRequestException('缺少CSV文件或内容为空');

    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table) throw new BadRequestException('Table not found');

    // 权限：编辑者、管理员允许导入（后续可扩展单独 importAllowedRoles）
    const allowed: Role[] = ['editor', 'admin'] as any;
    if (!allowed.includes(user.role)) throw new ForbiddenException('IMPORT_FORBIDDEN');

    const fields = await this.prisma.field.findMany({ where: { tableId }, orderBy: { id: 'asc' } });
    const byId = new Map(fields.map((f) => [f.id, f]));
    const byName = new Map(fields.map((f) => [f.name, f]));
    const byIdStr = new Map(fields.map((f) => [String(f.id), f]));

    const encoding = opts?.encoding || 'utf-8';
    const text = file.buffer.toString(encoding);
    const delimiter = opts?.delimiter === '\t' ? '\t' : (opts?.delimiter || ',');
    const rows = this.parseCsv(text, delimiter);
    if (rows.length === 0) throw new BadRequestException('CSV内容为空');

    const hasHeader = opts?.hasHeader !== false;
    const header = hasHeader ? rows[0] : Array.from({ length: rows[0].length }).map((_, i) => `col${i + 1}`);
    const body = hasHeader ? rows.slice(1) : rows;

    // 初始化进度：校验阶段
    this.setProgress(tableId, { status: 'validating', total: body.length, processed: 0, percent: 0, message: undefined, startedAt: Date.now(), finishedAt: undefined });

    // 生成映射：优先使用客户端提供的映射，其次按表头匹配字段名/ID
    let headerMap: Array<{ field: typeof fields[number] | null; index: number }> = [];
    if (opts?.mapping && Object.keys(opts.mapping).length > 0) {
      headerMap = Object.keys(opts.mapping).map((k) => {
        const index = Number(k);
        const fid = Number((opts!.mapping as any)[k]);
        const field = byId.get(fid) || null;
        return { field, index };
      });
    } else {
      headerMap = header.map((h, i) => {
        const byN = byName.get(h);
        if (byN) return { field: byN, index: i };
        const byI = byIdStr.get(h);
        if (byI) return { field: byI, index: i };
        return { field: null, index: i };
      });
    }

    const ignoreUnknown = opts?.ignoreUnknownColumns !== false;

    // 预校验阶段
    type RowError = { rowIndex: number; issues: Array<{ columnIndex: number; fieldId?: number; message: string }> };
    const errors: RowError[] = [];
    const validRows: Array<{ values: Record<string, any>; srcRowIndex: number; srcRowData: string[] }> = [];

    for (let rIdx = 0; rIdx < body.length; rIdx++) {
      const row = body[rIdx];
      const values: Record<string, any> = {};
      const issues: RowError['issues'] = [];

      for (const { field, index } of headerMap) {
        const raw = row[index] ?? '';
        if (!field) {
          if (!ignoreUnknown && String(raw || '').trim().length > 0) {
            issues.push({ columnIndex: index, message: '未知列，且配置为不忽略' });
          }
          continue;
        }
        const vr = this.validateAndCoerce(field, raw);
        if (!vr.ok) {
          if (String(raw || '').trim().length > 0) {
            issues.push({ columnIndex: index, fieldId: field.id, message: vr.message });
          }
          continue;
        }
        if (vr.value !== undefined) values[String(field.id)] = vr.value;
      }

      if (issues.length > 0) {
        errors.push({ rowIndex: hasHeader ? rIdx + 2 : rIdx + 1, issues });
      } else {
        validRows.push({ values, srcRowIndex: hasHeader ? rIdx + 2 : rIdx + 1, srcRowData: row });
      }
    }

    if (opts?.dryRun) {
      // dryRun 完成，进度置为 done
      this.setProgress(tableId, { status: 'done', processed: body.length, percent: 100, finishedAt: Date.now(), message: 'dryRun completed' });

      // 生成失败报告（dryRun）
      if (errors.length > 0) {
        const errMap = new Map<number, string[]>();
        for (const e of errors) errMap.set(e.rowIndex, e.issues.map(i => `col${i.columnIndex + 1}${i.fieldId ? `(#${i.fieldId})` : ''}: ${i.message}`));
        const rowsReport = Array.from(errMap.keys()).map((rowIndex) => {
          const idxInBody = hasHeader ? rowIndex - 2 : rowIndex - 1;
          const src = body[idxInBody] || [];
          const values: Record<string, any> = {};
          for (let i = 0; i < header.length; i++) values[header[i]] = src[i] ?? '';
          return { rowIndex, values, errors: errMap.get(rowIndex) || [] };
        });
        this.setLastFailureReport(tableId, {
          generatedAt: Date.now(),
          source: 'dryRun',
          hasHeader,
          delimiter,
          totalRows: body.length,
          failedCount: rowsReport.length,
          headers: header,
          rows: rowsReport,
        });
      } else {
        this.setLastFailureReport(tableId, null);
      }

      return {
        dryRun: true,
        totalRows: body.length,
        valid: validRows.length,
        invalid: errors.length,
        errors,
      };
    }

    // 插入阶段
    this.setProgress(tableId, { status: 'inserting', processed: 0, percent: 0, message: undefined });
    const createdIds: number[] = [];
    let insertError: { rowIndex: number; message: string } | null = null;

    for (let i = 0; i < validRows.length; i++) {
      const payload = validRows[i];
      try {
        const rec = await this.records.create(tableId, { values: payload.values });
        createdIds.push(rec.id);
        // 更新进度
        const processed = i + 1;
        const total = validRows.length || body.length || 1;
        const percent = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
        this.setProgress(tableId, { status: 'inserting', processed, total, percent });
      } catch (e: any) {
        insertError = { rowIndex: validRows[i].srcRowIndex, message: e?.message || '插入失败' };
        this.setProgress(tableId, { status: 'error', message: insertError.message });
        break;
      }
    }

    let rolledBack = false;
    if (insertError && (opts?.rollbackOnError !== false) && createdIds.length > 0) {
      try {
        await this.prisma.record.deleteMany({ where: { id: { in: createdIds } } });
        rolledBack = true;
      } catch {}
    }

    // 记录日志
    await this.prisma.log.create({
      data: {
        action: LogAction.import,
        tableId,
        userId: user.id,
        count: insertError && rolledBack ? 0 : createdIds.length,
      },
    });

    // 若失败，生成失败报告（import）
    if (insertError) {
      const idxInBody = hasHeader ? insertError.rowIndex - 2 : insertError.rowIndex - 1;
      const src = body[idxInBody] || [];
      const values: Record<string, any> = {};
      for (let i = 0; i < header.length; i++) values[header[i]] = src[i] ?? '';
      this.setLastFailureReport(tableId, {
        generatedAt: Date.now(),
        source: 'import',
        hasHeader,
        delimiter,
        totalRows: body.length,
        failedCount: 1,
        headers: header,
        rows: [{ rowIndex: insertError.rowIndex, values, errors: [insertError.message] }],
      });
    } else {
      this.setLastFailureReport(tableId, null);
    }

    // 完成/失败 终态
    if (insertError) {
      this.setProgress(tableId, { status: 'error', finishedAt: Date.now(), message: insertError.message });
    } else {
      this.setProgress(tableId, { status: 'done', processed: body.length, total: body.length, percent: 100, finishedAt: Date.now() });
    }

    return {
      dryRun: false,
      totalRows: body.length,
      inserted: insertError && rolledBack ? 0 : createdIds.length,
      invalid: errors.length + (insertError ? 1 : 0),
      errors: insertError ? [...errors, { rowIndex: insertError.rowIndex, issues: [{ columnIndex: -1, message: insertError.message }] }] : errors,
      rolledBack,
    };
  }

  private validateAndCoerce(field: any, raw: string): { ok: true; value: any } | { ok: false; message: string } {
    const s = String(raw ?? '').trim();
    if (s.length === 0) return { ok: true, value: undefined };
    const opts = (field.optionsJson ?? {}) as any;

    switch (field.type as FieldType) {
      case FieldType.text:
        return { ok: true, value: s };
      case FieldType.number: {
        const n = Number(s.replace(/,/g, ''));
        if (!Number.isFinite(n)) return { ok: false, message: `${field.name} 需要数值` };
        if (typeof opts.min === 'number' && n < opts.min) return { ok: false, message: `${field.name} 小于最小值 ${opts.min}` };
        if (typeof opts.max === 'number' && n > opts.max) return { ok: false, message: `${field.name} 大于最大值 ${opts.max}` };
        if (typeof opts.precision === 'number') {
          const p = opts.precision;
          const str = String(n);
          const dec = str.includes('.') ? str.split('.')[1].length : 0;
          if (dec > p) return { ok: false, message: `${field.name} 小数位超过 ${p}` };
        }
        return { ok: true, value: n };
      }
      case FieldType.boolean: {
        const v = s.toLowerCase();
        const trueSet = new Set(['true', '1', 'yes', 'y', '是']);
        const falseSet = new Set(['false', '0', 'no', 'n', '否']);
        if (trueSet.has(v)) return { ok: true, value: true };
        if (falseSet.has(v)) return { ok: true, value: false };
        return { ok: false, message: `${field.name} 需要布尔值` };
      }
      case FieldType.single_select: {
        const options: string[] = Array.isArray(opts.options) ? opts.options : [];
        if (!options.includes(s)) return { ok: false, message: `${field.name} 选项无效：${s}` };
        return { ok: true, value: s };
      }
      case FieldType.multi_select: {
        const parts = s
          .split(/[,;]/)
          .map((p: string) => p.trim())
          .filter((p: string) => p.length > 0);
        const options: string[] = Array.isArray(opts.options) ? opts.options : [];
        for (const p of parts) if (!options.includes(p)) return { ok: false, message: `${field.name} 选项无效：${p}` };
        return { ok: true, value: parts };
      }
      case FieldType.date: {
        // 简化：接受任意非空字符串，由前端或后续规则保证格式
        return { ok: true, value: s };
      }
      case FieldType.attachment:
        return { ok: false, message: `${field.name} 不支持通过CSV导入附件` };
      case FieldType.formula:
        return { ok: false, message: `${field.name} 为公式字段，值由系统计算` };
      default:
        return { ok: false, message: `不支持的字段类型：${field.type}` };
    }
  }

  // 简易CSV解析，支持双引号，自定义分隔符
  private parseCsv(text: string, delimiter: string = ','): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    const len = text.length;
    for (let i = 0; i < len; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { field += '"'; i++; continue; }
        if (ch === '"') { inQuotes = false; continue; }
        field += ch;
      } else {
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === delimiter) { row.push(field); field = ''; continue; }
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        if (ch === '\r') { continue; }
        field += ch;
      }
    }
    // flush
    row.push(field);
    rows.push(row);
    return rows.filter((r) => r.length && !(r.length === 1 && r[0].trim().length === 0));
  }
}