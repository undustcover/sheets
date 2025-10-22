import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ViewsService } from './views.service';
import { ViewsController } from './views.controller';
import { RecordsModule } from '../records/records.module';
import { ViewDataController } from './views.controller';

@Module({
  imports: [PrismaModule, RecordsModule],
  controllers: [ViewsController, ViewDataController],
  providers: [ViewsService],
  exports: [ViewsService],
})
export class ViewsModule {}