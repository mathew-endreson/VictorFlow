import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DbModule } from './infra/db/db.module';
import { RedisModule } from './infra/redis/redis.module';
import { StorageModule } from './infra/storage/storage.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CrmModule } from './modules/crm/crm.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthController } from './modules/health/health.controller';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LicensingModule } from './modules/licensing/licensing.module';
import { ProductionModule } from './modules/production/production.module';
import { SalesModule } from './modules/sales/sales.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { WorkforceModule } from './modules/workforce/workforce.module';

@Module({
  imports: [
    // infrastructure
    ConfigModule, DbModule, RedisModule, StorageModule,
    // Order matters for global guards: AuthModule's AuthGuard is registered first (401 before anything else),
    // LicensingModule's LicenseGuard second.
    AuthModule, LicensingModule,
    // domain modules
    CrmModule, SalesModule, ProductionModule, FinanceModule, InventoryModule, WorkforceModule, TrackingModule,
    AuditModule, DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
