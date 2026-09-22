import { Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Row } from '@victorflow/db';
import type {
  ContactDto,
  CreateContactDto,
  CreateCustomerDto,
  CustomerDetailDto,
  CustomerDto,
  CustomerListQuery,
  Page,
  UpdateContactDto,
  UpdateCustomerDto,
} from '@victorflow/types';
import { iso, likePattern, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService } from '../../infra/db/db.service';

const CUSTOMER_COLUMNS = [
  'id', 'code', 'name', 'customer_type', 'nif', 'nis', 'rc', 'ai', 'email', 'phone',
  'address', 'wilaya', 'city', 'custom_fields', 'is_active', 'created_at', 'updated_at',
] as const;

const CONTACT_COLUMNS = ['id', 'customer_id', 'full_name', 'job_title', 'email', 'phone', 'is_primary'] as const;

type CustomerRow = Pick<Row<'crm.customers'>, (typeof CUSTOMER_COLUMNS)[number]>;
type ContactRow = Pick<Row<'crm.contacts'>, (typeof CONTACT_COLUMNS)[number]>;

export const toCustomerDto = (r: CustomerRow): CustomerDto => ({
  id: r.id,
  code: r.code,
  name: r.name,
  customerType: r.customer_type,
  nif: r.nif,
  nis: r.nis,
  rc: r.rc,
  ai: r.ai,
  email: r.email,
  phone: r.phone,
  address: r.address,
  wilaya: r.wilaya,
  city: r.city,
  customFields: r.custom_fields,
  isActive: r.is_active,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const toContactDto = (r: ContactRow): ContactDto => ({
  id: r.id,
  customerId: r.customer_id,
  fullName: r.full_name,
  jobTitle: r.job_title,
  email: r.email,
  phone: r.phone,
  isPrimary: r.is_primary,
});

@Injectable()
export class CustomersService {
  constructor(private readonly dbs: DbService) {}

  async list(query: CustomerListQuery): Promise<Page<CustomerDto>> {
    let q = this.dbs.db.selectFrom('crm.customers');

    if (query.search) {
      const like = likePattern(query.search);
      q = q.where((eb) => eb.or([eb('name', 'ilike', like), eb('code', 'ilike', like), eb('email', 'ilike', like), eb('phone', 'ilike', like)]));
    }
    if (query.isActive !== undefined) q = q.where('is_active', '=', query.isActive);
    if (query.cfKey) {
      // Containment (@>) is what the GIN index on custom_fields accelerates.
      q = q.where(sql<boolean>`custom_fields @> ${JSON.stringify({ [query.cfKey]: query.cfValue ?? '' })}::jsonb`);
    }

    const { n } = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    const rows = await q
      .select(CUSTOMER_COLUMNS)
      .orderBy('name')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(rows.map(toCustomerDto), toCount(n), query.page, query.pageSize);
  }

  async get(id: string): Promise<CustomerDetailDto> {
    const row = await this.dbs.db.selectFrom('crm.customers').select(CUSTOMER_COLUMNS).where('id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundException('Customer not found');
    const contacts = await this.dbs.db
      .selectFrom('crm.contacts')
      .select(CONTACT_COLUMNS)
      .where('customer_id', '=', id)
      .orderBy('is_primary', 'desc')
      .orderBy('full_name')
      .execute();
    return { ...toCustomerDto(row), contacts: contacts.map(toContactDto) };
  }

  async create(dto: CreateCustomerDto, actorId: string): Promise<CustomerDto> {
    const row = await this.dbs.transaction((trx) =>
      trx
        .insertInto('crm.customers')
        .values({
          name: dto.name,
          customer_type: dto.customerType,
          nif: dto.nif ?? null,
          nis: dto.nis ?? null,
          rc: dto.rc ?? null,
          ai: dto.ai ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
          wilaya: dto.wilaya ?? null,
          city: dto.city ?? null,
          custom_fields: JSON.stringify(dto.customFields),
          is_active: dto.isActive,
          created_by: actorId,
        })
        .returning(CUSTOMER_COLUMNS)
        .executeTakeFirstOrThrow(),
    );
    return toCustomerDto(row);
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerDto> {
    const patch = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.customerType !== undefined && { customer_type: dto.customerType }),
      ...(dto.nif !== undefined && { nif: dto.nif }),
      ...(dto.nis !== undefined && { nis: dto.nis }),
      ...(dto.rc !== undefined && { rc: dto.rc }),
      ...(dto.ai !== undefined && { ai: dto.ai }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.wilaya !== undefined && { wilaya: dto.wilaya }),
      ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.customFields !== undefined && { custom_fields: JSON.stringify(dto.customFields) }),
      ...(dto.isActive !== undefined && { is_active: dto.isActive }),
    };
    const row = await this.dbs.transaction((trx) =>
      trx.updateTable('crm.customers').set(patch).where('id', '=', id).returning(CUSTOMER_COLUMNS).executeTakeFirst(),
    );
    if (!row) throw new NotFoundException('Customer not found');
    return toCustomerDto(row);
  }

  /** Customers referenced by quotes, orders or invoices cannot be deleted (FK) → 409; deactivate them instead. */
  async remove(id: string): Promise<void> {
    const res = await this.dbs.transaction((trx) => trx.deleteFrom('crm.customers').where('id', '=', id).executeTakeFirst());
    if (res.numDeletedRows === 0n) throw new NotFoundException('Customer not found');
  }

  // ── contacts ───────────────────────────────────────────────────────────────

  async addContact(customerId: string, dto: CreateContactDto): Promise<ContactDto> {
    const exists = await this.dbs.db.selectFrom('crm.customers').select('id').where('id', '=', customerId).executeTakeFirst();
    if (!exists) throw new NotFoundException('Customer not found');

    const row = await this.dbs.transaction(async (trx) => {
      if (dto.isPrimary) await trx.updateTable('crm.contacts').set({ is_primary: false }).where('customer_id', '=', customerId).execute();
      return trx
        .insertInto('crm.contacts')
        .values({
          customer_id: customerId,
          full_name: dto.fullName,
          job_title: dto.jobTitle ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          is_primary: dto.isPrimary,
        })
        .returning(CONTACT_COLUMNS)
        .executeTakeFirstOrThrow();
    });
    return toContactDto(row);
  }

  async updateContact(id: string, dto: UpdateContactDto): Promise<ContactDto> {
    const patch = {
      ...(dto.fullName !== undefined && { full_name: dto.fullName }),
      ...(dto.jobTitle !== undefined && { job_title: dto.jobTitle }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.isPrimary !== undefined && { is_primary: dto.isPrimary }),
    };
    const row = await this.dbs.transaction(async (trx) => {
      const current = await trx.selectFrom('crm.contacts').select('customer_id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!current) return undefined;
      if (dto.isPrimary) {
        await trx.updateTable('crm.contacts').set({ is_primary: false }).where('customer_id', '=', current.customer_id).where('id', '<>', id).execute();
      }
      return trx.updateTable('crm.contacts').set(patch).where('id', '=', id).returning(CONTACT_COLUMNS).executeTakeFirst();
    });
    if (!row) throw new NotFoundException('Contact not found');
    return toContactDto(row);
  }

  async removeContact(id: string): Promise<void> {
    const res = await this.dbs.transaction((trx) => trx.deleteFrom('crm.contacts').where('id', '=', id).executeTakeFirst());
    if (res.numDeletedRows === 0n) throw new NotFoundException('Contact not found');
  }
}
