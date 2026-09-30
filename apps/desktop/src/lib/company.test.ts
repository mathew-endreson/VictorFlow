import { COMPANY_LOGO_MAX_BYTES, type CompanyProfileDto } from '@victorflow/types';
import { describe, expect, it } from 'vitest';
import { fromCompany, logoProblem, toCompanyPayload } from './company';

const profile = (over: Partial<CompanyProfileDto> = {}): CompanyProfileDto => ({ configured: true, name: 'Acme', address: null, phone: null, email: null, nif: null, nis: null, rc: null, ai: null, logoDataUrl: null, ...over });

describe('company form helpers', () => {
  it('shows null fields as empty text, and trims on the way out (an emptied field is sent as "" so the server clears it)', () => {
    expect(fromCompany(profile())).toEqual({ name: 'Acme', address: '', phone: '', email: '', nif: '', nis: '', rc: '', ai: '' });
    const out = toCompanyPayload({ ...fromCompany(profile()), name: '  Acme SARL ', phone: ' 0555 ', nif: '' });
    expect(out).toMatchObject({ name: 'Acme SARL', phone: '0555', nif: '' });
  });

  it('accepts PNG / JPEG / WebP up to the size cap, and explains anything else', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(logoProblem({ type, size: 1000 })).toBeNull();
    expect(logoProblem({ type: 'image/png', size: COMPANY_LOGO_MAX_BYTES })).toBeNull();
    expect(logoProblem({ type: 'image/png', size: COMPANY_LOGO_MAX_BYTES + 1 })).toBe('size');
    expect(logoProblem({ type: 'image/svg+xml', size: 1000 })).toBe('type');
    expect(logoProblem({ type: 'application/pdf', size: 1000 })).toBe('type');
    expect(logoProblem({ type: '', size: 1000 })).toBe('type');
  });
});
