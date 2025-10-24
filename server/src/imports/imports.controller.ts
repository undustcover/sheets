import { Body, Controller, Param, ParseIntPipe, Post, UploadedFile, UseGuards, UseInterceptors, Req, Get, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { ImportsService } from './imports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/tables')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Roles(Role.editor, Role.admin)
  @Post(':id/import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB CSV
    }),
  )
  async importCsv(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('format') format?: string,
    @Body('delimiter') delimiter?: string,
    @Body('encoding') encoding?: string,
    @Body('hasHeader') hasHeader?: string,
    @Body('mapping') mapping?: string,
    @Body('ignoreUnknownColumns') ignoreUnknownColumns?: string,
    @Body('dryRun') dryRun?: string,
    @Body('rollbackOnError') rollbackOnError?: string,
    @Req() req?: any,
  ) {
    // 当前仅支持CSV
    const fmt = (format || 'csv').toLowerCase();
    if (fmt !== 'csv') {
      throw new Error('Only csv import is supported for now');
    }

    const user = req?.user as { id: number; role: Role };

    // 解析选项
    let parsedMapping: Record<number, number> | undefined;
    if (mapping) {
      try {
        const m = JSON.parse(mapping);
        if (m && typeof m === 'object') {
          parsedMapping = Object.keys(m).reduce((acc: any, k) => {
            const ki = Number(k);
            const v = Number((m as any)[k]);
            if (!Number.isNaN(ki) && !Number.isNaN(v)) acc[ki] = v;
            return acc;
          }, {});
        }
      } catch {}
    }

    const opts = {
      delimiter: delimiter === '\\t' ? '\t' : delimiter,
      encoding: encoding || 'utf-8',
      hasHeader: hasHeader === undefined ? true : hasHeader !== 'false',
      ignoreUnknownColumns: ignoreUnknownColumns === undefined ? true : ignoreUnknownColumns !== 'false',
      mapping: parsedMapping,
      dryRun: dryRun === 'true',
      rollbackOnError: rollbackOnError === undefined ? true : rollbackOnError !== 'false',
    } as any;

    return await this.imports.importCsv(id, user, file, opts);
  }

  @Roles(Role.editor, Role.admin)
  @Get(':id/import/progress')
  async getImportProgress(@Param('id', ParseIntPipe) id: number) {
    return this.imports.getProgress(id);
  }

  @Roles(Role.editor, Role.admin)
  @Get(':id/import/failures.csv')
  async downloadImportFailuresCsv(@Param('id', ParseIntPipe) id: number, @Res() res: any) {
    const report = this.imports.getLastFailureReport(id);
    if (!report || !report.rows || report.rows.length === 0) {
      return res.status(404).json({ message: 'NO_FAILURE_REPORT' });
    }
    const headers = ['rowIndex', ...report.headers, '_errors'];
    const escape = (v: any) => {
      const s = String(v ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const lines: string[] = [];
    lines.push(headers.join(','));
    for (const row of report.rows) {
      const cols = [escape(row.rowIndex)];
      for (const h of report.headers) cols.push(escape(row.values[h]));
      cols.push(escape(row.errors.join('; ')));
      lines.push(cols.join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="import_failures_${id}.csv"`);
    return res.send(lines.join('\n'));
  }
}