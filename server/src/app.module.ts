import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TablesModule } from './tables/tables.module';
import { FieldsModule } from './fields/fields.module';
import { RecordsModule } from './records/records.module';
import { CellsModule } from './cells/cells.module';
import { ViewsModule } from './views/views.module';
import { ExportsModule } from './exports/exports.module';
import { LogsModule } from './logs/logs.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { ImportsModule } from './imports/imports.module';

@Module({
  imports: [AuthModule, UsersModule, TablesModule, FieldsModule, RecordsModule, CellsModule, ViewsModule, ExportsModule, LogsModule, AttachmentsModule, ImportsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
