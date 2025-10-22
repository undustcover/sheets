import { Body, Controller, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { CellsService } from './cells.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { BatchWriteDto } from './dto/batch-write.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.editor, Role.exporter, Role.admin)
@Controller('api/tables/:tableId/cells')
export class CellsController {
  constructor(private readonly cells: CellsService) {}

  @Post('batch')
  async batchWrite(@Param('tableId', ParseIntPipe) tableId: number, @Body() dto: BatchWriteDto, @Req() req: any) {
    const user = req.user as { id: number };
    return await this.cells.batchWrite(tableId, dto, user);
  }
}