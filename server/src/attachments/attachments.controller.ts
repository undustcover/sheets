import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Get,
  Param,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { AttachmentsService } from './attachments.service';
import type { Response } from 'express';
import { createReadStream, readFileSync } from 'fs';

@Controller('api/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.editor, Role.admin)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('tableId') tableIdRaw: string,
    @Body('recordId') recordIdRaw?: string,
  ) {
    const tableId = parseInt(String(tableIdRaw), 10);
    const recordId = recordIdRaw !== undefined && recordIdRaw !== null ? parseInt(String(recordIdRaw), 10) : undefined;
    if (recordIdRaw !== undefined && Number.isNaN(recordId)) {
      throw new BadRequestException('非法的 recordId');
    }

    const saved = await this.attachments.saveUploadedFile({ file, tableId, recordId });
    return {
      id: saved.id,
      tableId: saved.tableId,
      recordId: saved.recordId ?? null,
      filename: saved.filename,
      storedName: saved.storedName,
      mime: saved.mime,
      size: saved.size,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.viewer, Role.editor, Role.exporter, Role.admin)
  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { fullPath, storedName, mime } = await this.attachments.getFileById(id);
    const isText = (mime && mime.startsWith('text/')) || (!mime || mime === 'application/octet-stream') && storedName.toLowerCase().endsWith('.txt');
    if (isText) {
      const content = readFileSync(fullPath, 'utf8');
      res.setHeader('Content-Type', 'text/plain');
      res.send(content);
      return;
    }
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${storedName}"`);
    const stream = createReadStream(fullPath);
    stream.pipe(res);
  }
}