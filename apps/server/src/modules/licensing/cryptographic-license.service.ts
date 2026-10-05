import path from 'node:path';
import { Inject, Injectable, Logger, Optional, UnprocessableEntityException } from '@nestjs/common';
import { findRepoRoot } from '@victorflow/db';
import { extractLicenceToken, formatLicenceText, hardwareId, verifyLicense, type LicensePayload } from '@victorflow/crypto';
import { APP_RELEASE_DATE, LICENSE_FEATURES, type EntitlementDto, type LicenceProblem, type LicenseFeature, type LicenseStatusDto } from '@victorflow/types';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { readLicenceFile, writeLicenceFile } from './licence-file';
import { LicenseService } from './license.service';

/** Where this machine's identity comes from — injectable so tests can simulate "a different machine". */
export abstract class HardwareIdProvider {
  abstract get(): string;
}
/** Reads the registry once (two reg.exe calls), then remembers the answer for the life of the process. */
@Injectable()
export class DefaultHardwareIdProvider extends HardwareIdProvider {
  private value?: string;
  get(): string {
    this.value ??= hardwareId();
    return this.value;
  }
}

export const LICENSE_CLOCK = Symbol('LICENSE_CLOCK');
/** The running version's release date (APP_RELEASE_DATE); injectable for tests. */
export const LICENSE_RELEASE_DATE = Symbol('LICENSE_RELEASE_DATE');

interface Verdict {
  entitlement: EntitlementDto | null;
  problem: LicenceProblem | null;
  /** From an authentic payload, even one that does not apply here (wrong hardware, updates expired). */
  activationCode: string | null;
}

/**
 * Verifies the vendor-signed licence file:  base64url(payload) "." base64url(Ed25519 signature)  in armour lines,
 * with `crypto.verify(null, data, publicKey, signature)` (see @victorflow/crypto — Ed25519 takes NO digest algorithm).
 * Order: signature → payload → hardware binding → issue date → updates. Nothing in an unsigned payload is trusted.
 */
@Injectable()
export class CryptographicLicenseService extends LicenseService {
  readonly mode = 'crypto' as const;
  private readonly logger = new Logger(CryptographicLicenseService.name);
  private cache?: { at: number; verdict: Verdict };
  private static readonly CACHE_MS = 15_000;
  private readonly releaseDate: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hardware: HardwareIdProvider,
    @Optional() @Inject(LICENSE_CLOCK) private readonly clock: (() => Date) | null,
    @Optional() @Inject(LICENSE_RELEASE_DATE) releaseDate: string | null,
  ) {
    super();
    this.releaseDate = releaseDate ?? APP_RELEASE_DATE;
  }

  private now(): Date {
    return this.clock ? this.clock() : new Date();
  }

  private file(): string {
    return path.isAbsolute(this.config.licenseFile) ? this.config.licenseFile : path.resolve(findRepoRoot(), this.config.licenseFile);
  }

  private check(text: string) {
    return verifyLicense({ token: text, publicKey: this.config.licensePublicKey, hardwareId: this.hardware.get(), releaseDate: this.releaseDate, now: this.now() });
  }

  private async evaluate(): Promise<Verdict> {
    const now = this.now().getTime();
    if (this.cache && now - this.cache.at < CryptographicLicenseService.CACHE_MS) return this.cache.verdict;
    const verdict = await this.evaluateUncached();
    this.cache = { at: now, verdict };
    return verdict;
  }

  private async evaluateUncached(): Promise<Verdict> {
    let text: string | null;
    try {
      text = await readLicenceFile(this.file());
    } catch (e) {
      this.logger.error(`The licence file could not be read: ${(e as Error).message}`);
      return { entitlement: null, problem: { code: 'LICENSE_FILE_UNREADABLE', message: `The licence file could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` }, activationCode: null };
    }
    if (text === null) return { entitlement: null, problem: { code: 'NO_LICENSE_FILE', message: 'No licence is installed yet' }, activationCode: null };
    const v = this.check(text);
    if (!v.ok) {
      this.logger.warn(`Licence rejected: ${v.code} — ${v.message}`);
      return { entitlement: null, problem: { code: v.code, message: v.message }, activationCode: v.payload?.activationCode ?? null };
    }
    return { entitlement: toEntitlement(v.payload), problem: null, activationCode: v.payload.activationCode };
  }

  async getEntitlement(): Promise<EntitlementDto | null> {
    return (await this.evaluate()).entitlement;
  }

  async status(): Promise<LicenseStatusDto> {
    const v = await this.evaluate();
    return {
      mode: 'crypto',
      enforced: this.config.licenseEnforce,
      valid: v.entitlement !== null,
      state: this.config.licenseEnforce && !v.entitlement ? 'read_only' : 'active',
      entitlement: v.entitlement,
      problem: v.problem,
      hardwareId: this.hardware.get(),
      activationCode: v.activationCode,
      releaseDate: this.releaseDate,
      online: this.config.licenseServerUrl !== null,
    };
  }

  isEnforced(): boolean {
    return this.config.licenseEnforce;
  }

  hardwareId(): string {
    return this.hardware.get();
  }

  async install(text: string): Promise<LicenseStatusDto> {
    const v = this.check(text);
    if (!v.ok) {
      throw new UnprocessableEntityException({ message: `This licence cannot be used here: ${v.message}`, code: 'LICENCE_REJECTED', licenceProblem: v.code });
    }
    const p = v.payload;
    await writeLicenceFile(this.file(), formatLicenceText(extractLicenceToken(text), [`VictorFlow licence ${p.licenceId} - ${p.shop}`]));
    this.cache = undefined;
    this.logger.log(`Licence ${p.licenceId} installed for "${p.shop}" (${p.edition}; desktop ${p.seats.desktop}, mobile ${p.seats.mobile}; modules ${p.modules.join(', ')}; updates until ${p.updatesUntil})`);
    return this.status();
  }
}

/** Unknown module ids (from a newer issuer) are ignored. */
function toEntitlement(p: LicensePayload): EntitlementDto {
  return {
    licenceId: p.licenceId,
    shop: p.shop,
    edition: p.edition,
    activationCode: p.activationCode,
    hardwareId: p.hardwareId,
    seats: { desktop: p.seats.desktop, mobile: p.seats.mobile },
    modules: p.modules.filter((m): m is LicenseFeature => (LICENSE_FEATURES as readonly string[]).includes(m)),
    issuedAt: p.issuedAt,
    updatesUntil: p.updatesUntil,
  };
}
