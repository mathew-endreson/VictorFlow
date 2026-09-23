import type { Row } from '@victorflow/db';
import type { ServiceDto } from '@victorflow/types';

export const SERVICE_COLUMNS = ['id', 'code', 'name', 'pricing_unit', 'price_ratio', 'batch_size', 'is_active'] as const;

export type ServiceRow = Pick<Row<'erp.services'>, (typeof SERVICE_COLUMNS)[number]>;

export const toServiceDto = (r: ServiceRow): ServiceDto => ({
  id: r.id,
  code: r.code,
  name: r.name,
  pricingUnit: r.pricing_unit,
  priceRatio: r.price_ratio,
  batchSize: r.batch_size,
  isActive: r.is_active,
});
