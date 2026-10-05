import { BadRequestException } from '@nestjs/common';
import { encodeRequestCode, formatActivationCode, isValidActivationCode, LICENSE_FEATURES, type EntitlementDto, type LicenceRequestDto, type LicenceSeats, type LicenceSummaryDto, type LicenseFeature, type LicenseStatusDto } from '@victorflow/types';

/**
 * The contract the rest of the app codes against. Two implementations:
 *   DevLicenseService            — development: everything unlocked, nothing to install
 *   CryptographicLicenseService  — an Ed25519-signed licence file bound to this server's hardware id
 *
 * The state that matters to everyone else:
 *   active     the licence is valid: the modules it lists work, the others are refused (LICENSE_FEATURE)
 *   read_only  the licence check failed: every module can still be read and exported, nothing can be changed
 *              (LICENCE_READ_ONLY) — a shop is never locked out of its data
 * Nothing is ever blocked while enforcement is off (LICENSE_ENFORCE=false, development only).
 */
export abstract class LicenseService {
  abstract readonly mode: 'dev' | 'crypto';
  /** The current entitlement, or null when there is no valid licence. */
  abstract getEntitlement(): Promise<EntitlementDto | null>;
  /** Full picture for the licence screen and the onboarding. */
  abstract status(): Promise<LicenseStatusDto>;
  /** Whether the licence may actually BLOCK requests (LICENSE_ENFORCE). */
  abstract isEnforced(): boolean;
  /** This server's hardware id. */
  abstract hardwareId(): string;
  /** Verifies a licence (armoured text or bare token) and installs it; refuses one that is not valid HERE. */
  abstract install(text: string): Promise<LicenseStatusDto>;

  /** What every signed-in user may know: which modules exist for them, and whether everything is read-only. */
  async summary(): Promise<LicenceSummaryDto> {
    const s = await this.status();
    if (!s.enforced) return { mode: s.mode, state: 'active', modules: [...LICENSE_FEATURES], problem: null };
    if (!s.entitlement) return { mode: s.mode, state: 'read_only', modules: [...LICENSE_FEATURES], problem: s.problem?.code ?? 'NO_LICENSE_FILE' };
    return { mode: s.mode, state: 'active', modules: s.entitlement.modules, problem: null };
  }

  /** Seats of the valid licence, or null (no licence: nothing to count against). */
  async seats(): Promise<LicenceSeats | null> {
    return (await this.getEntitlement())?.seats ?? null;
  }

  async hasModule(module: LicenseFeature): Promise<boolean> {
    return (await this.summary()).modules.includes(module);
  }

  /** The request code the shop sends to BluxTech for this activation code. */
  requestCode(code: string): LicenceRequestDto {
    if (!isValidActivationCode(code)) {
      throw new BadRequestException({ message: 'This activation code is not valid: check every character', code: 'ACTIVATION_CODE_INVALID' });
    }
    const activationCode = formatActivationCode(code);
    const hardwareId = this.hardwareId();
    return { activationCode, hardwareId, requestCode: encodeRequestCode({ activationCode, hardwareId }) };
  }
}
