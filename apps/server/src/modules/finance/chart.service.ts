import { NotFoundException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { AccountDto, CreateAccountDto, CreateFiscalYearDto, FiscalYearDto, JournalDto } from '@victorflow/types';
import { DbService } from '../../infra/db/db.service';

@Injectable()
export class ChartService {
  constructor(private readonly dbs: DbService) {}

  async listAccounts(): Promise<AccountDto[]> {
    const rows = await this.dbs.db
      .selectFrom('finance.chart_of_accounts as a')
      .leftJoin('finance.chart_of_accounts as p', 'p.id', 'a.parent_id')
      .select(['a.id', 'a.code', 'a.name', 'a.account_type', 'p.code as parent_code', 'a.is_postable', 'a.is_active'])
      .orderBy('a.code')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      accountType: r.account_type,
      parentCode: r.parent_code,
      isPostable: r.is_postable,
      isActive: r.is_active,
    }));
  }

  async createAccount(dto: CreateAccountDto): Promise<AccountDto> {
    return this.dbs.transaction(async (trx) => {
      let parentId: string | null = null;
      if (dto.parentCode) {
        const parent = await trx.selectFrom('finance.chart_of_accounts').select('id').where('code', '=', dto.parentCode).executeTakeFirst();
        if (!parent) throw new UnprocessableEntityException({ message: `Unknown parent account ${dto.parentCode}`, code: 'UNKNOWN_ACCOUNT' });
        parentId = parent.id;
      }
      const row = await trx
        .insertInto('finance.chart_of_accounts')
        .values({ code: dto.code, name: dto.name, account_type: dto.accountType, parent_id: parentId, is_postable: dto.isPostable })
        .returning(['id', 'code', 'name', 'account_type', 'is_postable', 'is_active'])
        .executeTakeFirstOrThrow();
      return { id: row.id, code: row.code, name: row.name, accountType: row.account_type, parentCode: dto.parentCode ?? null, isPostable: row.is_postable, isActive: row.is_active };
    });
  }

  async listJournals(): Promise<JournalDto[]> {
    const rows = await this.dbs.db.selectFrom('finance.journals').select(['id', 'code', 'name', 'journal_type']).where('is_active', '=', true).orderBy('code').execute();
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, journalType: r.journal_type }));
  }

  async listFiscalYears(): Promise<FiscalYearDto[]> {
    const rows = await this.dbs.db.selectFrom('finance.fiscal_years').select(['id', 'code', 'start_date', 'end_date', 'status']).orderBy('start_date', 'desc').execute();
    return rows.map((r) => ({ id: r.id, code: r.code, startDate: r.start_date, endDate: r.end_date, status: r.status }));
  }

  /** Overlapping years are rejected by an EXCLUDE constraint in the database (→ 409). */
  async createFiscalYear(dto: CreateFiscalYearDto): Promise<FiscalYearDto> {
    const r = await this.dbs.transaction((trx) =>
      trx
        .insertInto('finance.fiscal_years')
        .values({ code: dto.code, start_date: dto.startDate, end_date: dto.endDate })
        .returning(['id', 'code', 'start_date', 'end_date', 'status'])
        .executeTakeFirstOrThrow(),
    );
    return { id: r.id, code: r.code, startDate: r.start_date, endDate: r.end_date, status: r.status };
  }

  async closeFiscalYear(id: string): Promise<FiscalYearDto> {
    const r = await this.dbs.transaction((trx) =>
      trx.updateTable('finance.fiscal_years').set({ status: 'CLOSED' }).where('id', '=', id).returning(['id', 'code', 'start_date', 'end_date', 'status']).executeTakeFirst(),
    );
    if (!r) throw new NotFoundException('Fiscal year not found');
    return { id: r.id, code: r.code, startDate: r.start_date, endDate: r.end_date, status: r.status };
  }
}
