import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TablesModule } from './tables/tables.module';
import { FieldsModule } from './fields/fields.module';
import { RecordsModule } from './records/records.module';
import { CellsModule } from './cells/cells.module';

@Module({
  imports: [AuthModule, UsersModule, TablesModule, FieldsModule, RecordsModule, CellsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
