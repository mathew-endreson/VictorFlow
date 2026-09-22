import { Controller, Get, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PERMISSIONS, type LicenseStatusDto } from '@victorflow/types';
import { RequirePermissions } from '../../common/decorators';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { CryptographicLicenseService, DefaultHardwareIdProvider, HardwareIdProvider, LICENSE_CLOCK } from './cryptographic-license.service';
import { DevLicenseService } from './dev-license.service';
import { LicenseGuard } from './license.guard';
import { LicenseService } from './license.service';

@Controller('license')
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  @RequirePermissions(PERMISSIONS.CORE_LICENSE_READ)
  @Get()
  status(): Promise<LicenseStatusDto> {
    return this.license.status();
  }
}

@Global()
@Module({
  controllers: [LicenseController],
  providers: [
    { provide: HardwareIdProvider, useClass: DefaultHardwareIdProvider },
    { provide: LICENSE_CLOCK, useValue: null },
    DevLicenseService,
    CryptographicLicenseService,
    // The rest of the app depends on the abstract LicenseService only; LICENSE_MODE picks the implementation.
    {
      provide: LicenseService,
      inject: [APP_CONFIG, DevLicenseService, CryptographicLicenseService],
      useFactory: (config: AppConfig, dev: DevLicenseService, crypto: CryptographicLicenseService): LicenseService =>
        config.licenseMode === 'crypto' ? crypto : dev,
    },
    // Registered after AuthModule's guard (import order), so anonymous callers get 401 before any licence answer.
    { provide: APP_GUARD, useClass: LicenseGuard },
  ],
  exports: [LicenseService],
})
export class LicensingModule {}
