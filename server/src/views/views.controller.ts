import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ViewsService } from './views.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { CreateViewDto } from './dto/create-view.dto';
import { UpdateViewDto } from './dto/update-view.dto';

// 视图 CRUD 需管理员权限
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin)
@Controller('api/tables/:tableId/views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get()
  async list(@Param('tableId', ParseIntPipe) tableId: number) {
    return await this.views.list(tableId);
  }

  @Get(':id')
  async get(@Param('tableId', ParseIntPipe) tableId: number, @Param('id', ParseIntPipe) id: number) {
    return await this.views.get(tableId, id);
  }

  @Post()
  async create(@Param('tableId', ParseIntPipe) tableId: number, @Body() dto: CreateViewDto) {
    return await this.views.create(tableId, { name: dto.name, type: dto.type, configJson: dto.configJson, anonymousEnabled: dto.anonymousEnabled });
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateViewDto) {
    return await this.views.update(id, { name: dto.name, type: dto.type, configJson: dto.configJson, anonymousEnabled: dto.anonymousEnabled });
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.views.remove(id);
  }
}

// 公共读取接口：允许匿名视图访问
@Controller('api/views')
export class ViewDataController {
  constructor(private readonly views: ViewsService) {}

  @Get(':id/data')
  async getData(
    @Param('id', ParseIntPipe) id: number,
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

    // 允许匿名时返回；若视图未开启匿名，Service 将抛出 401
    return await this.views.getData(id, {
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
      filters: parsedFilters,
      sort: parsedSort,
    }, true);
  }
}