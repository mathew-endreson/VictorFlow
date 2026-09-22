import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { sql } from '@victorflow/db';
import { PERMISSIONS, type DashboardSummaryDto } from '@victorflow/types';
import { RequirePermissions } from '../../common/decorators';
import { DbService } from '../../infra/db/db.service';

const n = (v: string | number | bigint | null | undefined): number => Number(v ?? 0);
const money = (v: string | null | undefined): string => v ?? '0.0000';

@Injectable()
export class DashboardService {
  constructor(private readonly dbs: DbService) {}

  /** One round of small aggregate queries; every figure is computed in the database, money stays a decimal string. */
  async summary(): Promise<DashboardSummaryDto> {
    const db = this.dbs.db;
    const [customers, orders, production, invoices, revenue, collected, lowStock] = await Promise.all([
      sql<{ total: string; active: string }>`select count(*)::text as total, (count(*) filter (where is_active))::text as active from crm.customers`.execute(db),
      sql<{ status: string; n: string }>`select status, count(*)::text as n from erp.orders group by status`.execute(db),
      sql<{ status: string; n: string }>`select status, count(*)::text as n from erp.production_orders group by status`.execute(db),
      sql<{ unpaid: string; overdue: string; due: string }>`
        select (count(*) filter (where status in ('ISSUED','PARTIALLY_PAID')))::text as unpaid,
               (count(*) filter (where status in ('ISSUED','PARTIALLY_PAID') and due_date < current_date))::text as overdue,
               coalesce(sum(total_ttc - amount_paid) filter (where status in ('ISSUED','PARTIALLY_PAID')), 0)::numeric(15,4)::text as due
          from finance.invoices`.execute(db),
      sql<{ month: string; cnt: string; ht: string; tva: string; ttc: string }>`
        select to_char(date_trunc('month', current_date), 'YYYY-MM') as month,
               count(*)::text as cnt,
               coalesce(sum(total_ht), 0)::numeric(15,4)::text as ht,
               coalesce(sum(total_tva), 0)::numeric(15,4)::text as tva,
               coalesce(sum(total_ttc), 0)::numeric(15,4)::text as ttc
          from finance.invoices
         where status <> 'CANCELLED'
           and invoice_date >= date_trunc('month', current_date)::date
           and invoice_date <  (date_trunc('month', current_date) + interval '1 month')::date`.execute(db),
      sql<{ amount: string }>`
        select coalesce(sum(amount), 0)::numeric(15,4)::text as amount
          from finance.payments
         where paid_at >= date_trunc('month', current_date)::date
           and paid_at <  (date_trunc('month', current_date) + interval '1 month')::date`.execute(db),
      sql<{ n: string }>`
        select count(*)::text as n from (
          select i.id from inventory.items i left join inventory.stock_levels sl on sl.item_id = i.id
           where i.is_active group by i.id having coalesce(sum(sl.quantity), 0) < i.min_stock) t`.execute(db),
    ]);

    const byStatus = (rows: Array<{ status: string; n: string }>) => Object.fromEntries(rows.map((r) => [r.status, n(r.n)]));
    const orderCounts = byStatus(orders.rows);
    const rev = revenue.rows[0]!;
    const inv = invoices.rows[0]!;

    return {
      generatedAt: new Date().toISOString(),
      customers: { total: n(customers.rows[0]!.total), active: n(customers.rows[0]!.active) },
      orders: { open: (orderCounts.DRAFT ?? 0) + (orderCounts.CONFIRMED ?? 0) + (orderCounts.IN_PRODUCTION ?? 0), byStatus: orderCounts },
      production: { byStatus: byStatus(production.rows) },
      invoices: { unpaidCount: n(inv.unpaid), overdueCount: n(inv.overdue), balanceDue: money(inv.due) },
      revenue: { month: rev.month, invoiceCount: n(rev.cnt), ht: money(rev.ht), tva: money(rev.tva), ttc: money(rev.ttc), collected: money(collected.rows[0]!.amount) },
      lowStockItems: n(lowStock.rows[0]!.n),
    };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @RequirePermissions(PERMISSIONS.CORE_DASHBOARD_READ)
  @Get('summary')
  summary(): Promise<DashboardSummaryDto> {
    return this.dashboard.summary();
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
