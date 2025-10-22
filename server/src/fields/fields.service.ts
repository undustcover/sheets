import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FieldType } from '@prisma/client';

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

  async create(tableId: number, data: { name: string; type: FieldType; optionsJson?: any; readonly?: boolean }) {
    const created = await this.prisma.field.create({
      data: {
        tableId,
        name: data.name,
        type: data.type,
        optionsJson: data.optionsJson ?? {},
        readonly: data.readonly ?? false,
      },
    });
    return created;
  }

  async update(id: number, data: { name?: string; type?: FieldType; optionsJson?: any; readonly?: boolean }) {
    const updated = await this.prisma.field.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.optionsJson !== undefined ? { optionsJson: data.optionsJson } : {}),
        ...(data.readonly !== undefined ? { readonly: data.readonly } : {}),
      },
    });
    return updated;
  }

  async remove(id: number) {
    await this.prisma.field.delete({ where: { id } });
    return { success: true };
  }
}