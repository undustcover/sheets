import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { FieldsService } from './fields.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { CreateFieldDto } from './dto/create-field.dto';
import { UpdateFieldDto } from './dto/update-field.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin)
@Controller('api/tables/:tableId/fields')
export class FieldsController {
  constructor(private readonly fields: FieldsService) {}

  @Get()
  async list(@Param('tableId', ParseIntPipe) tableId: number) {
    return await this.fields.list(tableId);
  }

  @Get(':id')
  async get(@Param('tableId', ParseIntPipe) tableId: number, @Param('id', ParseIntPipe) id: number) {
    return await this.fields.get(tableId, id);
  }

  @Post()
  async create(@Param('tableId', ParseIntPipe) tableId: number, @Body() dto: CreateFieldDto) {
    return await this.fields.create(tableId, { name: dto.name, type: dto.type, optionsJson: dto.optionsJson, readonly: dto.readonly });
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFieldDto) {
    return await this.fields.update(id, { name: dto.name, type: dto.type, optionsJson: dto.optionsJson, readonly: dto.readonly });
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.fields.remove(id);
  }
}