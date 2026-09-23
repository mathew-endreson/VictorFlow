import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { ProductionModule } from '../production/production.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ProofsService } from './proofs.service';
import { SyncService } from './sync.service';
import { TasksService } from './tasks.service';
import { SyncController, WorkforceController } from './workforce.controller';

@Module({
  imports: [
    ProductionModule, // finishing a linked task completes its work order
    // No `storage` option → uploads stay in memory. The size cap is enforced WHILE streaming (→ 413), not after.
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 10 } }),
    }),
  ],
  controllers: [SyncController, WorkforceController, AttendanceController],
  providers: [SyncService, ProofsService, TasksService, AttendanceService],
})
export class WorkforceModule {}
