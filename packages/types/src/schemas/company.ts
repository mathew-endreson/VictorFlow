import { z } from 'zod';

/** The logo is shown small in a document header; anything bigger than this is a photo, not a logo. */
export const COMPANY_LOGO_MAX_BYTES = 512 * 1024;
export const COMPANY_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Trimmed free text where an empty string means "not provided" (stored as NULL). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === '' ? null : v.toLowerCase())) // lower-cased like every other e-mail in the app (see emailSchema)
  .pipe(z.email().nullable())
  .nullable()
  .optional();

/** The whole profile is saved at once (PUT): a field left out is cleared, so the form and the record never drift apart. */
export const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: optionalText(500),
  phone: optionalText(40),
  email: optionalEmail,
  nif: optionalText(40),
  nis: optionalText(40),
  rc: optionalText(40),
  ai: optionalText(40),
});
export type UpdateCompanyDto = z.infer<typeof updateCompanySchema>;

export interface CompanyProfileDto {
  /** False until the profile has been saved once — documents then fall back to the VictorFlow header. */
  configured: boolean;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  nif: string | null;
  nis: string | null;
  rc: string | null;
  ai: string | null;
  /** The logo inlined as a `data:` URL (it is small, and this lets it be printed without a second authenticated request). */
  logoDataUrl: string | null;
}
