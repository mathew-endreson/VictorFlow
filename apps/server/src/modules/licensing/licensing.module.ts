import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { AuthModule } from '../auth/auth.module';
import { CompanyModule } from '../company/company.module';
import { CryptographicLicenseService, DefaultHardwareIdProvider, HardwareIdProvider, LICENSE_CLOCK, LICENSE_RELEASE_DATE } from './cryptographic-license.service';
import { DevLicenseService } from './dev-license.service';
import { LicenseController } from './license.controller';
import { LicenseGuard } from './license.guard';
import { LicenseService } from './license.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnlineActivationService } from './online-activation.service';
import { SeatService } from './seat.service';

@Global()
@Module({
  controllers: [LicenseController],
  providers: [
    { provide: HardwareIdProvider, useClass: DefaultHardwareIdProvider },
    { provide: LICENSE_CLOCK, useValue: null },
    { provide: LICENSE_RELEASE_DATE, useValue: null },
    DevLicenseService,
    CryptographicLicenseService,
    // The rest of the app depends on the abstract LicenseService only; LICENSE_MODE picks the implementation.
    {
      provide: LicenseService,
      inject: [APP_CONFIG, DevLicenseService, CryptographicLicenseService],
      useFactory: (config: AppConfig, dev: DevLicenseService, crypto: CryptographicLicenseService): LicenseService =>
        config.licenseMode === 'crypto' ? crypto : dev,
    },
    SeatService,
    OnlineActivationService,
    // Registered after AuthModule's guard (import order), so anonymous callers get 401 before any licence answer.
    { provide: APP_GUARD, useClass: LicenseGuard },
  ],
  exports: [LicenseService, SeatService, OnlineActivationService],
})
export class LicensingModule {}

/** The first-run wizard's API: licence → company profile → owner (a module of its own: it needs auth and company). */
@Module({
  imports: [AuthModule, CompanyModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
