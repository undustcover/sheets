import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecordsModule } from '../records/records.module';
import { ExportsService } from './exports.service';
import { ExportsController, TableExportsController } from './exports.controller';

@Module({
  imports: [PrismaModule, RecordsModule],
  controllers: [ExportsController, TableExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}