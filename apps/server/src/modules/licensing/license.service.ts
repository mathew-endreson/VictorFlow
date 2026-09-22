import type { EntitlementDto, LicenseFeature, LicenseStatusDto } from '@victorflow/types';

/**
 * The contract the rest of the app codes against. The MVP ships two implementations behind it:
 *   DevLicenseService            — always a valid PROFESSIONAL entitlement, no hardware check (local development)
 *   CryptographicLicenseService  — verifies an Ed25519-signed licence file against this machine's fingerprint
 * A future online/activation-server implementation only has to satisfy this same interface.
 */
export abstract class LicenseService {
  /** The current entitlement, or null when there is no valid licence. */
  abstract getEntitlement(): Promise<EntitlementDto | null>;
  abstract hasFeature(feature: LicenseFeature): Promise<boolean>;
  /** Full picture for the "License status" screen: mode, validity, the reason if invalid, this machine's id. */
  abstract status(): Promise<LicenseStatusDto>;
  /** Whether the licence may actually BLOCK requests (LICENSE_ENFORCE). */
  abstract isEnforced(): boolean;
  /** Seats: may another active user be added? */
  abstract canAddUser(currentActiveUsers: number): Promise<boolean>;
}
