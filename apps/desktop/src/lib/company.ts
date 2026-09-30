import { useQuery } from '@tanstack/react-query';
import { COMPANY_LOGO_MAX_BYTES, COMPANY_LOGO_MIME_TYPES, type CompanyProfileDto } from '@victorflow/types';
import { api } from './api';

/** The business's own details (name, contact, fiscal ids, logo) — printed in document headers, edited on the Company page. */
export const useCompany = () => useQuery({ queryKey: ['company'], queryFn: () => api.get<CompanyProfileDto>('/company'), staleTime: 5 * 60_000 });

export interface CompanyFormValues {
  name: string;
  address: string;
  phone: string;
  email: string;
  nif: string;
  nis: string;
  rc: string;
  ai: string;
}

export const fromCompany = (c: CompanyProfileDto): CompanyFormValues => ({
  name: c.name,
  address: c.address ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
  nif: c.nif ?? '',
  nis: c.nis ?? '',
  rc: c.rc ?? '',
  ai: c.ai ?? '',
});

/** The profile is saved as a whole: an emptied field is sent as '' and the server clears it. */
export const toCompanyPayload = (v: CompanyFormValues): CompanyFormValues => ({
  name: v.name.trim(),
  address: v.address.trim(),
  phone: v.phone.trim(),
  email: v.email.trim(),
  nif: v.nif.trim(),
  nis: v.nis.trim(),
  rc: v.rc.trim(),
  ai: v.ai.trim(),
});

/** Checked before uploading so a wrong file is explained instantly (the server re-checks by the file's real bytes). */
export const logoProblem = (file: { type: string; size: number }): 'type' | 'size' | null =>
  !(COMPANY_LOGO_MIME_TYPES as readonly string[]).includes(file.type) ? 'type' : file.size > COMPANY_LOGO_MAX_BYTES ? 'size' : null;

export const LOGO_MAX_LABEL = `${COMPANY_LOGO_MAX_BYTES / 1024} KB`;
