import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { findRepoRoot } from '@victorflow/db';
import { hardwareFingerprint, verifyLicense, type LicensePayload } from '@victorflow/crypto';
import { LICENSE_FEATURES, TIER_FEATURES, type EntitlementDto, type LicenseFeature, type LicenseStatusDto } from '@victorflow/types';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { LicenseService } from './license.service';

/** Where this machine's identity comes from — injectable so tests can simulate "a different machine". */
export abstract class HardwareIdProvider {
  abstract get(): string;
}
@Injectable()
export class DefaultHardwareIdProvider extends HardwareIdProvider {
  get(): string {
    return hardwareFingerprint();
  }
}

export const LICENSE_CLOCK = Symbol('LICENSE_CLOCK');

type Verdict = { entitlement: EntitlementDto; problem: null } | { entitlement: null; problem: { code: string; message: string } };

/**
 * Verifies a vendor-signed licence file:  base64url(payload) "." base64url(Ed25519 signature)
 * using `crypto.verify(null, data, publicKey, signature)` (see @victorflow/crypto — Ed25519 takes NO digest
 * algorithm; createVerify('SHA512') would be the wrong primitive). Order: signature → hardware binding → validity
 * window. Nothing in an unsigned payload is ever trusted.
 *
 * Whether an invalid licence actually BLOCKS anything is a separate switch (LICENSE_ENFORCE, see LicenseGuard).
 */
@Injectable()
export class CryptographicLicenseService extends LicenseService {
  private readonly logger = new Logger(CryptographicLicenseService.name);
  private cache?: { at: number; verdict: Verdict };
  private static readonly CACHE_MS = 15_000;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hardware: HardwareIdProvider,
    @Optional() @Inject(LICENSE_CLOCK) private readonly clock: (() => Date) | null,
  ) {
    super();
  }

  private now(): Date {
    return this.clock ? this.clock() : new Date();
  }

  private async evaluate(): Promise<Verdict> {
    const now = this.now().getTime();
    if (this.cache && now - this.cache.at < CryptographicLicenseService.CACHE_MS) return this.cache.verdict;
    const verdict = await this.evaluateUncached();
    this.cache = { at: now, verdict };
    return verdict;
  }

  private async evaluateUncached(): Promise<Verdict> {
    const problem = (code: string, message: string): Verdict => ({ entitlement: null, problem: { code, message } });

    if (!this.config.licensePublicKey) return problem('NO_PUBLIC_KEY', 'LICENSE_PUBLIC_KEY is not configured');

    const file = path.isAbsolute(this.config.licenseFile) ? this.config.licenseFile : path.resolve(findRepoRoot(), this.config.licenseFile);
    let token: string;
    try {
      token = await fs.readFile(file, 'utf8');
    } catch {
      return problem('NO_LICENSE_FILE', `No licence file at ${this.config.licenseFile}`);
    }

    const verdict = verifyLicense({ token, publicKey: this.config.licensePublicKey, hardwareId: this.hardware.get(), now: this.now() });
    if (!verdict.ok) {
      this.logger.warn(`Licence rejected: ${verdict.code} — ${verdict.message}`);
      return problem(verdict.code, verdict.message);
    }
    return { entitlement: toEntitlement(verdict.payload), problem: null };
  }

  async getEntitlement(): Promise<EntitlementDto | null> {
    return (await this.evaluate()).entitlement;
  }

  async hasFeature(feature: LicenseFeature): Promise<boolean> {
    const e = await this.getEntitlement();
    return e !== null && e.features.includes(feature);
  }

  async status(): Promise<LicenseStatusDto> {
    const v = await this.evaluate();
    return {
      mode: 'crypto',
      enforced: this.config.licenseEnforce,
      valid: v.entitlement !== null,
      entitlement: v.entitlement,
      problem: v.problem,
      hardwareId: this.hardware.get(),
    };
  }

  isEnforced(): boolean {
    return this.config.licenseEnforce;
  }

  async canAddUser(currentActiveUsers: number): Promise<boolean> {
    const e = await this.getEntitlement();
    return e !== null && currentActiveUsers < e.maxUsers;
  }
}

/** The licence names its features explicitly; anything unknown is ignored, and an empty list falls back to the tier's set. */
function toEntitlement(p: LicensePayload): EntitlementDto {
  const known = p.features.filter((f): f is LicenseFeature => (LICENSE_FEATURES as readonly string[]).includes(f));
  return {
    licenseId: p.licenseId,
    customer: p.customer,
    tier: p.tier,
    features: known.length > 0 ? known : [...TIER_FEATURES[p.tier]],
    maxUsers: p.maxUsers,
    hardwareBound: p.hardwareId !== null,
    issuedAt: p.issuedAt,
    expiresAt: p.expiresAt,
  };
}
