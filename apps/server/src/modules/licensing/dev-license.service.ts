import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { activationCodeFrom, APP_RELEASE_DATE, LICENSE_FEATURES, type EntitlementDto, type LicenseStatusDto } from '@victorflow/types';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { HardwareIdProvider } from './cryptographic-license.service';
import { LicenseService } from './license.service';

/**
 * DEVELOPMENT ONLY. Every module unlocked and seats without limit, with no signature or hardware check, so local
 * development is never blocked by licensing. loadConfig() refuses to start with LICENSE_MODE=dev in production.
 */
@Injectable()
export class DevLicenseService extends LicenseService {
  readonly mode = 'dev' as const;
  private readonly issuedAt = new Date().toISOString();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hardware: HardwareIdProvider,
  ) {
    super();
  }

  private entitlement(): EntitlementDto {
    return {
      licenceId: 'DEV-LOCAL',
      shop: 'Local development',
      edition: 'Development',
      activationCode: activationCodeFrom(Array(11).fill(0)),
      hardwareId: this.hardware.get(),
      seats: { desktop: 9999, mobile: 9999 },
      modules: [...LICENSE_FEATURES],
      issuedAt: this.issuedAt,
      updatesUntil: '9999-12-31',
    };
  }

  async getEntitlement(): Promise<EntitlementDto> {
    return this.entitlement();
  }

  async status(): Promise<LicenseStatusDto> {
    return {
      mode: 'dev',
      enforced: this.config.licenseEnforce,
      valid: true,
      state: 'active',
      entitlement: this.entitlement(),
      problem: null,
      hardwareId: this.hardware.get(),
      activationCode: null,
      releaseDate: APP_RELEASE_DATE,
      online: false,
    };
  }

  isEnforced(): boolean {
    return this.config.licenseEnforce;
  }

  hardwareId(): string {
    return this.hardware.get();
  }

  async install(): Promise<LicenseStatusDto> {
    throw new ConflictException({ message: 'This server runs with the development licence (LICENSE_MODE=dev): there is nothing to install', code: 'LICENSE_DEV_MODE' });
  }
}
