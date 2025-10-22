import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin)
@Controller('api/tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  async list() {
    return await this.tables.list();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return await this.tables.get(id);
  }

  @Post()
  async create(@Body() dto: CreateTableDto) {
    return await this.tables.create({ name: dto.name, metaJson: dto.metaJson, exportAllowedRoles: dto.exportAllowedRoles });
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTableDto) {
    return await this.tables.update(id, { name: dto.name, metaJson: dto.metaJson, exportAllowedRoles: dto.exportAllowedRoles });
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.tables.remove(id);
  }
}