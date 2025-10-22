import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TablesService } from './tables.service';
import { TablesController } from './tables.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}