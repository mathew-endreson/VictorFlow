import { z } from 'zod';
import { CUSTOMER_TYPES } from '../enums';
import { emailSchema, paginationSchema } from './common';

/** Optional free text: '' → null (clears the field); undefined → "leave unchanged" on PATCH. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const optEmail = z
  .union([z.literal('').transform(() => null), emailSchema])
  .nullable()
  .optional();

/** Flat JSON object with scalar values — enough for "extra fields" without letting anyone store a novel. */
export const customFieldsSchema = z
  .record(z.string().min(1).max(50), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .refine((o) => Object.keys(o).length <= 50, 'At most 50 custom fields');

const customerFields = {
  name: z.string().trim().min(2).max(200),
  customerType: z.enum(CUSTOMER_TYPES),
  nif: optText(30),
  nis: optText(30),
  rc: optText(30),
  ai: optText(30),
  email: optEmail,
  phone: optText(30),
  address: optText(300),
  wilaya: optText(60),
  city: optText(80),
  customFields: customFieldsSchema,
  isActive: z.boolean(),
};

export const createCustomerSchema = z.object({
  ...customerFields,
  customerType: customerFields.customerType.default('COMPANY'),
  customFields: customerFields.customFields.default({}),
  isActive: customerFields.isActive.default(true),
});
export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object(customerFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;

export const customerListQuerySchema = paginationSchema.extend({
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  /** Filter on one custom field, served by the GIN index on custom_fields: ?cfKey=source&cfValue=demo */
  cfKey: z.string().min(1).max(50).optional(),
  cfValue: z.string().max(500).optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const createContactSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  jobTitle: optText(80),
  email: optEmail,
  phone: optText(30),
  isPrimary: z.boolean().default(false),
});
export type CreateContactDto = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateContactDto = z.infer<typeof updateContactSchema>;

// ── responses ────────────────────────────────────────────────────────────────

export interface ContactDto {
  id: string;
  customerId: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface CustomerDto {
  id: string;
  code: string;
  name: string;
  customerType: (typeof CUSTOMER_TYPES)[number];
  nif: string | null;
  nis: string | null;
  rc: string | null;
  ai: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  wilaya: string | null;
  city: string | null;
  customFields: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetailDto extends CustomerDto {
  contacts: ContactDto[];
}
