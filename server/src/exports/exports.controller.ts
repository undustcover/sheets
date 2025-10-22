import { Body, Controller, Param, ParseIntPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { Response } from 'express';

@Controller('api/views')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.viewer, Role.editor, Role.exporter, Role.admin)
  @Post(':id/export')
  async exportView(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { format?: 'csv'|'xlsx' },
    @Req() req: any,
    @Res() res: Response,
  ) {
    const user = req.user as { id: number; role: Role };
    const format = body?.format ?? 'csv';
    if (format !== 'csv') {
      // 先支持 csv，xlsx 暂不实现
      throw new Error('Only csv export is supported for now');
    }

    const { filename, csv } = await this.exportsService.exportViewCsv(id, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/tables')
export class TableExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Post(':id/export')
  async exportTable(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { format?: 'csv'|'xlsx' },
    @Req() req: any,
    @Res() res: Response,
  ) {
    const user = req.user as { id: number; role: Role };
    const format = body?.format ?? 'csv';
    if (format !== 'csv') {
      throw new Error('Only csv export is supported for now');
    }

    const { filename, csv } = await this.exportsService.exportTableCsv(id, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }
}