import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FieldType, LogAction } from '@prisma/client';

@Injectable()
export class FieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tableId: number) {
    return this.prisma.field.findMany({
      where: { tableId },
      orderBy: { id: 'asc' },
    });
  }

  async get(tableId: number, id: number) {
    return this.prisma.field.findFirst({ where: { id, tableId } });
  }

  private validateOptions(type: FieldType, optionsJson: any) {
    const opts = optionsJson ?? {};
    switch (type) {
      case 'number': {
        if (opts.min !== undefined && typeof opts.min !== 'number') throw new BadRequestException('number.min must be number');
        if (opts.max !== undefined && typeof opts.max !== 'number') throw new BadRequestException('number.max must be number');
        if (opts.precision !== undefined && typeof opts.precision !== 'number') throw new BadRequestException('number.precision must be number');
        break;
      }
      case 'select': {
        const arr = opts.options;
        if (arr !== undefined && (!Array.isArray(arr) || arr.some((x: any) => typeof x !== 'string'))) {
          throw new BadRequestException('select.options must be string[]');
        }
        break;
      }
      case 'multi_select': {
        const arr = opts.options;
        if (arr !== undefined && (!Array.isArray(arr) || arr.some((x: any) => typeof x !== 'string'))) {
          throw new BadRequestException('multi_select.options must be string[]');
        }
        break;
      }
      case 'formula': {
        // 公式字段选项可选：precision等
        if (opts.precision !== undefined && typeof opts.precision !== 'number') throw new BadRequestException('formula.precision must be number');
        break;
      }
      default:
        break;
    }
    return opts;
  }

  async create(tableId: number, data: { name: string; type: FieldType; optionsJson?: any; readonly?: boolean }) {
    const exists = await this.prisma.field.findFirst({ where: { tableId, name: data.name } });
    if (exists) throw new BadRequestException('Field name already exists');

    const opts = this.validateOptions(data.type, data.optionsJson);
    const created = await this.prisma.field.create({
      data: {
        tableId,
        name: data.name,
        type: data.type,
        optionsJson: opts,
        readonly: data.readonly ?? false,
      },
    });

    // 字段结构变更，表revision++ 并记录审计（作为update_table）
    await this.prisma.table.update({ where: { id: tableId }, data: { revision: { increment: 1 } } });
    await this.prisma.log.create({ data: { action: LogAction.update_table, tableId } });
    return created;
  }

  async update(id: number, data: { name?: string; type?: FieldType; optionsJson?: any; readonly?: boolean }) {
    const current = await this.prisma.field.findUnique({ where: { id } });
    if (!current) throw new BadRequestException('Field not found');
    if (data.name && data.name !== current.name) {
      const dup = await this.prisma.field.findFirst({ where: { tableId: current.tableId, name: data.name } });
      if (dup) throw new BadRequestException('Field name already exists');
    }

    const targetType = data.type ?? current.type;
    const opts = data.optionsJson !== undefined ? this.validateOptions(targetType, data.optionsJson) : undefined;

    const updated = await this.prisma.field.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(opts !== undefined ? { optionsJson: opts } : {}),
        ...(data.readonly !== undefined ? { readonly: data.readonly } : {}),
      },
    });

    await this.prisma.table.update({ where: { id: current.tableId }, data: { revision: { increment: 1 } } });
    await this.prisma.log.create({ data: { action: LogAction.update_table, tableId: current.tableId } });
    return updated;
  }

  async remove(id: number) {
    const current = await this.prisma.field.findUnique({ where: { id } });
    if (!current) throw new BadRequestException('Field not found');
    await this.prisma.field.delete({ where: { id } });
    await this.prisma.table.update({ where: { id: current.tableId }, data: { revision: { increment: 1 } } });
    await this.prisma.log.create({ data: { action: LogAction.update_table, tableId: current.tableId } });
    return { success: true };
  }
}