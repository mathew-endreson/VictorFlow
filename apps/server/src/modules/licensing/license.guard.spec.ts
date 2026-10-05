import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { LICENSE_FEATURES, type LicenceSummaryDto, type LicenseFeature } from '@victorflow/types';
import { LICENCE_EXEMPT, REQUIRED_FEATURE } from '../../common/decorators';
import { LicenseGuard } from './license.guard';
import type { LicenseService } from './license.service';

const active = (modules: LicenseFeature[]): LicenceSummaryDto => ({ mode: 'crypto', state: 'active', modules, problem: null });
const readOnly = (problem = 'HARDWARE_MISMATCH'): LicenceSummaryDto => ({ mode: 'crypto', state: 'read_only', modules: [...LICENSE_FEATURES], problem });

function guard(opts: { enforced: boolean; summary: LicenceSummaryDto; method?: string; metadata?: Record<string, unknown> }) {
  const license = { isEnforced: () => opts.enforced, summary: async () => opts.summary } as unknown as LicenseService;
  const reflector = { getAllAndOverride: (key: string) => opts.metadata?.[key] } as unknown as Reflector;
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ method: opts.method ?? 'GET' }) }),
  } as unknown as ExecutionContext;
  return new LicenseGuard(reflector, license).canActivate(ctx);
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e as ForbiddenException).getResponse() as Record<string, unknown>;
  }
  return undefined;
};

describe('LicenseGuard', () => {
  it('LICENSE_ENFORCE=false is a hard no-op, whatever the licence and the method', async () => {
    expect(await guard({ enforced: false, summary: readOnly(), method: 'POST', metadata: { [REQUIRED_FEATURE]: 'finance' } })).toBe(true);
  });

  it('active: a licensed module works, read or write', async () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect(await guard({ enforced: true, summary: active(['crm', 'finance']), method, metadata: { [REQUIRED_FEATURE]: 'finance' } })).toBe(true);
    }
  });

  it('active: a module outside the licence is refused for reads AND writes (LICENSE_FEATURE), and says which', async () => {
    for (const method of ['GET', 'POST']) {
      expect(await refusal(guard({ enforced: true, summary: active(['crm']), method, metadata: { [REQUIRED_FEATURE]: 'finance' } }))).toMatchObject({ code: 'LICENSE_FEATURE', feature: 'finance' });
    }
    expect(await guard({ enforced: true, summary: active(['crm']), metadata: {} })).toBe(true); // a route of no module
  });

  it('READ-ONLY: GET, HEAD and OPTIONS pass for every module (never locked out of the data)', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(await guard({ enforced: true, summary: readOnly(), method, metadata: { [REQUIRED_FEATURE]: 'finance' } })).toBe(true);
    }
  });

  it('READ-ONLY: every write is refused with 403 LICENCE_READ_ONLY and the reason', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(await refusal(guard({ enforced: true, summary: readOnly('UPDATES_EXPIRED'), method, metadata: {} }))).toMatchObject({ code: 'LICENCE_READ_ONLY', licenceProblem: 'UPDATES_EXPIRED' });
    }
  });

  it('@LicenceExempt routes (sign-in, onboarding, installing a licence) pass even when read-only', async () => {
    expect(await guard({ enforced: true, summary: readOnly(), method: 'POST', metadata: { [LICENCE_EXEMPT]: true } })).toBe(true);
    expect(await guard({ enforced: true, summary: readOnly(), method: 'PUT', metadata: { [LICENCE_EXEMPT]: true } })).toBe(true);
  });
});
