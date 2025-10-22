import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RecordsModule } from '../records/records.module';

@Module({
  imports: [PrismaModule, RecordsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}