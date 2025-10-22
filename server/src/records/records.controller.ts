import { Controller, Get, Post, Body, Param, Delete, Put, Query } from '@nestjs/common';
import { RecordsService } from './records.service';
import { CreateRecordDto } from './dto/create-record.dto';
import { UpdateRecordDto } from './dto/update-record.dto';

@Controller('api/tables/:tableId/records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get()
  async list(
    @Param('tableId') tableId: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('filters') filters?: string,
    @Query('sort') sort?: string,
  ) {
    let parsedFilters: Array<{ fieldId: number; op: string; value?: any }> | undefined;
    let parsedSort: { fieldId: number; direction: 'asc' | 'desc' } | undefined;

    if (filters) {
      try {
        const f = JSON.parse(filters);
        if (Array.isArray(f)) parsedFilters = f.map((x) => ({ fieldId: Number(x.fieldId), op: String(x.op), value: x.value }));
      } catch {}
    }

    if (sort) {
      try {
        const s = JSON.parse(sort);
        if (s && s.fieldId) parsedSort = { fieldId: Number(s.fieldId), direction: s.direction === 'desc' ? 'desc' : 'asc' };
      } catch {}
    }

    return this.recordsService.list(Number(tableId), {
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
      filters: parsedFilters,
      sort: parsedSort,
    });
  }

  @Get(':id')
  async get(@Param('tableId') tableId: string, @Param('id') id: string) {
    return this.recordsService.get(Number(tableId), Number(id));
  }

  @Post()
  async create(@Param('tableId') tableId: string, @Body() dto: CreateRecordDto) {
    return this.recordsService.create(Number(tableId), dto);
  }

  @Put(':id')
  async update(@Param('tableId') tableId: string, @Param('id') id: string, @Body() dto: UpdateRecordDto) {
    return this.recordsService.update(Number(tableId), Number(id), dto);
  }

  @Delete(':id')
  async remove(@Param('tableId') tableId: string, @Param('id') id: string) {
    return this.recordsService.remove(Number(tableId), Number(id));
  }
}