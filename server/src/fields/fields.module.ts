import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FieldsService } from './fields.service';
import { FieldsController } from './fields.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FieldsController],
  providers: [FieldsService],
  exports: [FieldsService],
})
export class FieldsModule {}