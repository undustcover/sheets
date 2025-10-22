import { Body, Controller, Param, ParseIntPipe, Post, UploadedFile, UseGuards, UseInterceptors, Req } from '@nestjs/common';
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
    @Body('ignoreUnknownColumns') ignoreUnknownColumns?: string,
    @Req() req?: any,
  ) {
    // 当前仅支持CSV
    const fmt = (format || 'csv').toLowerCase();
    if (fmt !== 'csv') {
      throw new Error('Only csv import is supported for now');
    }

    const user = req?.user as { id: number; role: Role };
    return await this.imports.importCsv(id, user, file);
  }
}