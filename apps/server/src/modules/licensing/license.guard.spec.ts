import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { EntitlementDto, LicenseFeature, LicenseStatusDto } from '@victorflow/types';
import { IS_PUBLIC, REQUIRED_FEATURE } from '../../common/decorators';
import { LicenseGuard } from './license.guard';
import type { LicenseService } from './license.service';

const ent = (features: LicenseFeature[], tier: EntitlementDto['tier'] = 'BASIC'): EntitlementDto => ({
  licenseId: 'L', customer: 'C', tier, features, maxUsers: 5, hardwareBound: false, issuedAt: '2026-01-01T00:00:00Z', expiresAt: null,
});

function guard(opts: { enforced: boolean; entitlement: EntitlementDto | null; metadata?: Record<string, unknown> }) {
  const license = {
    isEnforced: () => opts.enforced,
    getEntitlement: async () => opts.entitlement,
    status: async (): Promise<LicenseStatusDto> => ({ mode: 'crypto', enforced: opts.enforced, valid: opts.entitlement !== null, entitlement: opts.entitlement, problem: opts.entitlement ? null : { code: 'BAD_SIGNATURE', message: 'Licence signature is invalid' }, hardwareId: 'hw' }),
  } as unknown as LicenseService;
  const reflector = { getAllAndOverride: (key: string) => opts.metadata?.[key] } as unknown as Reflector;
  const ctx = { getHandler: () => () => undefined, getClass: () => class {} } as unknown as ExecutionContext;
  return { run: () => new LicenseGuard(reflector, license).canActivate(ctx) };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as ForbiddenException).getResponse() as { code: string };
  }
  return undefined;
};

describe('LicenseGuard', () => {
  it('LICENSE_ENFORCE=false is a hard no-op: nothing is blocked, even with NO licence at all', async () => {
    expect(await guard({ enforced: false, entitlement: null, metadata: { [REQUIRED_FEATURE]: 'finance' } }).run()).toBe(true);
    expect(await guard({ enforced: false, entitlement: ent(['crm']), metadata: { [REQUIRED_FEATURE]: 'finance' } }).run()).toBe(true);
  });

  it('enforced: allows a route whose module the licence includes', async () => {
    expect(await guard({ enforced: true, entitlement: ent(['crm', 'finance']), metadata: { [REQUIRED_FEATURE]: 'finance' } }).run()).toBe(true);
  });

  it('enforced: refuses a module outside the licence (LICENSE_FEATURE) and says which', async () => {
    const r = await code(guard({ enforced: true, entitlement: ent(['crm']), metadata: { [REQUIRED_FEATURE]: 'finance' } }).run());
    expect(r).toMatchObject({ code: 'LICENSE_FEATURE', feature: 'finance' });
  });

  it('enforced: refuses everything licensed when there is no valid licence (LICENSE_INVALID)', async () => {
    const r = await code(guard({ enforced: true, entitlement: null, metadata: { [REQUIRED_FEATURE]: 'crm' } }).run());
    expect(r).toMatchObject({ code: 'LICENSE_INVALID', licenseProblem: 'BAD_SIGNATURE' });
  });

  it('enforced: never gates public routes or routes that name no licensed module (login, health, licence status)', async () => {
    expect(await guard({ enforced: true, entitlement: null, metadata: { [IS_PUBLIC]: true, [REQUIRED_FEATURE]: 'crm' } }).run()).toBe(true);
    expect(await guard({ enforced: true, entitlement: null, metadata: {} }).run()).toBe(true);
  });
});
