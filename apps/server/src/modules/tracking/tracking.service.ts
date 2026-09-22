import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { trackingToken, verifyTrackingToken } from '@victorflow/crypto';
import type { OrderStatus, PublicTrackingDto, TrackingLinkDto, TrackingStepDto } from '@victorflow/types';
import { iso, isoOrNull } from '../../common/paging';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { DbService } from '../../infra/db/db.service';

/** Compared against when the order does not exist, so "no such order" costs the same as "wrong token". */
const NIL_CUSTOMER = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STEPS: Array<{ key: TrackingStepDto['key']; label: string }> = [
  { key: 'RECEIVED', label: 'Order received' },
  { key: 'CONFIRMED', label: 'Order confirmed' },
  { key: 'IN_PRODUCTION', label: 'In production' },
  { key: 'QUALITY_CHECK', label: 'Quality check' },
  { key: 'COMPLETED', label: 'Ready' },
];

/** How far along an order is, from its own status and its production order's status. Internal states collapse
 *  into the five customer-facing steps (a QC rejection / rework simply reads as "in production" again). */
function progressIndex(orderStatus: OrderStatus, productionStatus: string | null): number {
  if (orderStatus === 'COMPLETED' || productionStatus === 'COMPLETED') return 4;
  if (productionStatus === 'QUALITY_CHECK') return 3;
  if (productionStatus === 'IN_PRODUCTION' || productionStatus === 'REJECTED' || orderStatus === 'IN_PRODUCTION') return 2;
  if (orderStatus === 'CONFIRMED') return 1;
  return 0;
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The customer-facing link for an order (used for QR codes and printed paperwork). */
  async linkFor(orderId: string): Promise<TrackingLinkDto> {
    const order = await this.dbs.db.selectFrom('erp.orders').select(['id', 'customer_id']).where('id', '=', orderId).executeTakeFirst();
    if (!order) throw new NotFoundException('Order not found');
    const token = trackingToken(this.config.trackingHmacSecret, order.id, order.customer_id);
    return { orderId: order.id, token, url: `${this.config.trackerBaseUrl}/t/${order.id}/${token}` };
  }

  /**
   * Resolve a public link. The token is HMAC-SHA256(serverSecret, orderId + customerId), compared in constant time
   * (crypto.timingSafeEqual). The compare ALWAYS runs — against a nil customer id when the order is unknown — and
   * both failures give the identical 404, so neither the response nor its timing reveals whether an order exists.
   */
  async resolve(orderId: string, token: string): Promise<PublicTrackingDto> {
    const plausible = UUID_RE.test(orderId) && token.length > 0 && token.length <= 128;
    const order = plausible
      ? await this.dbs.db
          .selectFrom('erp.orders')
          .select(['id', 'number', 'status', 'customer_id', 'created_at', 'confirmed_at', 'due_date'])
          .where('id', '=', orderId)
          .executeTakeFirst()
      : undefined;

    const authentic = verifyTrackingToken(this.config.trackingHmacSecret, orderId, order?.customer_id ?? NIL_CUSTOMER, token);
    if (!order || !authentic) throw new NotFoundException('Tracking link not found');

    const production = await this.dbs.db.selectFrom('erp.production_orders').select(['id', 'status']).where('order_id', '=', order.id).executeTakeFirst();
    const events = production
      ? await this.dbs.db.selectFrom('erp.production_order_events').select(['to_status', 'created_at']).where('production_order_id', '=', production.id).orderBy('id').execute()
      : [];
    const items = await this.dbs.db.selectFrom('erp.order_items').select(['description', 'quantity', 'unit']).where('order_id', '=', order.id).orderBy('position').execute();

    const progress = progressIndex(order.status, production?.status ?? null);
    // when each customer-visible step was (last) reached; states the customer should not see are simply absent
    const reachedAt: Partial<Record<TrackingStepDto['key'], Date>> = { RECEIVED: order.created_at };
    if (order.confirmed_at) reachedAt.CONFIRMED = order.confirmed_at;
    for (const e of events) {
      if (e.to_status === 'IN_PRODUCTION' || e.to_status === 'QUALITY_CHECK' || e.to_status === 'COMPLETED') reachedAt[e.to_status] = e.created_at;
    }

    const steps: TrackingStepDto[] = STEPS.map((s, i) => ({
      key: s.key,
      label: s.label,
      at: i <= progress ? isoOrNull(reachedAt[s.key] ?? null) : null,
      done: i <= progress,
      current: i === progress,
    }));

    const cancelled = order.status === 'CANCELLED';
    const current = STEPS[progress]!;
    // Deliberately absent: prices/totals, customer identity, staff names, notes, internal ids and status history.
    return {
      orderNumber: order.number,
      status: cancelled ? { key: 'CANCELLED', label: 'Cancelled' } : { key: current.key, label: current.label },
      placedAt: iso(order.created_at),
      expectedDate: order.due_date,
      cancelled,
      steps,
      items: items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit })),
    };
  }
}
