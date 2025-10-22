import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LogsService } from './logs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role, LogAction } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin)
@Controller('api/logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('tableId') tableId?: string,
    @Query('viewId') viewId?: string,
  ) {
    return this.logs.list({
      page: page ? Number(page) : undefined,
      size: size ? Number(size) : undefined,
      action: action as LogAction,
      userId: userId ? Number(userId) : undefined,
      tableId: tableId ? Number(tableId) : undefined,
      viewId: viewId ? Number(viewId) : undefined,
    });
  }
}