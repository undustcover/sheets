import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CellsService } from './cells.service';
import { CellsController } from './cells.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CellsController],
  providers: [CellsService],
})
export class CellsModule {}