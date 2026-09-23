import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from '@victorflow/db';
import type { CreateServiceDto, Page, ServiceDto, ServiceListQuery, UpdateServiceDto } from '@victorflow/types';
import { offsetOf, toCount, toPage } from '../../common/paging';
import { DbService } from '../../infra/db/db.service';
import { SERVICE_COLUMNS, toServiceDto } from './services.mapper';

/** The services catalogue (area/length/batch pricing). Admin-managed: create/edit is gated by
 * sales.service.write; existing order lines already snapshot whatever a service's rate was at the time,
 * so editing a rate here never touches a past order or invoice. */
@Injectable()
export class ServicesService {
  constructor(private readonly dbs: DbService) {}

  async list(query: ServiceListQuery): Promise<Page<ServiceDto>> {
    let q = this.dbs.db.selectFrom('erp.services');
    if (query.activeOnly) q = q.where('is_active', '=', true);

    const { n } = await q.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await q.select(SERVICE_COLUMNS).orderBy('name').limit(query.pageSize).offset(offsetOf(query.page, query.pageSize)).execute();
    return toPage(rows.map(toServiceDto), toCount(n), query.page, query.pageSize);
  }

  async create(dto: CreateServiceDto): Promise<ServiceDto> {
    const existing = await this.dbs.db.selectFrom('erp.services').select('id').where('code', '=', dto.code).executeTakeFirst();
    if (existing) throw new ConflictException({ message: `A service with code "${dto.code}" already exists`, code: 'SERVICE_CODE_TAKEN' });

    const row = await this.dbs.db
      .insertInto('erp.services')
      .values({ code: dto.code, name: dto.name, pricing_unit: dto.pricingUnit, price_ratio: dto.priceRatio, batch_size: dto.batchSize })
      .returning(SERVICE_COLUMNS)
      .executeTakeFirstOrThrow();
    return toServiceDto(row);
  }

  async update(id: string, dto: UpdateServiceDto): Promise<ServiceDto> {
    const patch = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.priceRatio !== undefined && { price_ratio: dto.priceRatio }),
      ...(dto.batchSize !== undefined && { batch_size: dto.batchSize }),
      ...(dto.isActive !== undefined && { is_active: dto.isActive }),
    };
    const row = await this.dbs.db.updateTable('erp.services').set(patch).where('id', '=', id).returning(SERVICE_COLUMNS).executeTakeFirst();
    if (!row) throw new NotFoundException('Service not found');
    return toServiceDto(row);
  }
}
