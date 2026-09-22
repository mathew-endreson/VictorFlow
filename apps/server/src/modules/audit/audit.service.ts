import { Injectable } from '@nestjs/common';
import { sql } from '@victorflow/db';
import type { AuditEntryDto, AuditListQuery, AuditVerifyDto, Page } from '@victorflow/types';
import { iso, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService } from '../../infra/db/db.service';

@Injectable()
export class AuditService {
  constructor(private readonly dbs: DbService) {}

  /** Read the trail (append-only; written exclusively by database triggers). Newest first. */
  async list(query: AuditListQuery): Promise<Page<AuditEntryDto>> {
    const base = this.dbs.db.selectFrom('audit.trail as a').leftJoin('core.users as u', 'u.id', 'a.actor_id');
    const apply = (q: typeof base) => {
      let out = q;
      if (query.table) {
        const [schema, table] = query.table.split('.') as [string, string];
        out = out.where('a.table_schema', '=', schema).where('a.table_name', '=', table);
      }
      if (query.rowId) out = out.where('a.row_id', '=', query.rowId);
      if (query.actorId) out = out.where('a.actor_id', '=', query.actorId);
      if (query.operation) out = out.where('a.operation', '=', query.operation);
      return out;
    };

    const { n } = await apply(base).select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await apply(base)
      .select([
        'a.id', 'a.created_at', 'a.table_schema', 'a.table_name', 'a.operation', 'a.row_id', 'a.actor_id', 'u.full_name as actor_name',
        'a.old_data', 'a.new_data', 'a.row_hash',
      ])
      .orderBy('a.id', 'desc')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();

    return toPage(
      rows.map((r) => ({
        id: r.id,
        createdAt: iso(r.created_at),
        table: `${r.table_schema}.${r.table_name}`,
        operation: r.operation,
        rowId: r.row_id,
        actorId: r.actor_id,
        actorName: r.actor_name,
        oldData: r.old_data,
        newData: r.new_data,
        rowHash: r.row_hash,
      })),
      toCount(n),
      query.page,
      query.pageSize,
    );
  }

  /** Walk the whole hash chain (audit.verify_chain()). Any edited, removed or inserted row is reported. */
  async verifyChain(): Promise<AuditVerifyDto> {
    const { rows } = await sql<{ checked: string; first_broken_id: string | null; reason: string | null }>`select * from audit.verify_chain()`.execute(this.dbs.db);
    const r = rows[0]!;
    return { ok: r.first_broken_id === null, checked: toCount(r.checked), firstBrokenId: r.first_broken_id, reason: r.reason, verifiedAt: new Date().toISOString() };
  }
}
