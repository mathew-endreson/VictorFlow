import { Inject, Injectable } from '@nestjs/common';
import { hardwareFingerprint } from '@victorflow/crypto';
import { TIER_FEATURES, type EntitlementDto, type LicenseFeature, type LicenseStatusDto } from '@victorflow/types';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { LicenseService } from './license.service';

/**
 * MVP-NOTE: DEV STUB. Hands every install a valid, perpetual PROFESSIONAL entitlement with no signature check and no
 * hardware check, so local development is never blocked by licensing. loadConfig() refuses to start with
 * LICENSE_MODE=dev in production.
 */
@Injectable()
export class DevLicenseService extends LicenseService {
  private readonly issuedAt = new Date().toISOString();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  private entitlement(): EntitlementDto {
    return {
      licenseId: 'DEV-LOCAL',
      customer: 'Local development',
      tier: 'PROFESSIONAL',
      features: [...TIER_FEATURES.PROFESSIONAL],
      maxUsers: 9999,
      hardwareBound: false,
      issuedAt: this.issuedAt,
      expiresAt: null,
    };
  }

  async getEntitlement(): Promise<EntitlementDto> {
    return this.entitlement();
  }

  async hasFeature(feature: LicenseFeature): Promise<boolean> {
    return TIER_FEATURES.PROFESSIONAL.includes(feature);
  }

  async status(): Promise<LicenseStatusDto> {
    return {
      mode: 'dev',
      enforced: this.config.licenseEnforce,
      valid: true,
      entitlement: this.entitlement(),
      problem: null,
      hardwareId: hardwareFingerprint(),
    };
  }

  isEnforced(): boolean {
    return this.config.licenseEnforce;
  }

  async canAddUser(): Promise<boolean> {
    return true;
  }
}
