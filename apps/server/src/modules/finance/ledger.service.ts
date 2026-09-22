import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type Database, type Kysely } from '@victorflow/db';
import {
  formatMoney,
  parseMoney,
  type EntryDetailDto,
  type EntryListQuery,
  type EntrySourceType,
  type EntrySummaryDto,
  type Page,
  type PostEntryDto,
  type ReverseEntryDto,
  type TrialBalanceDto,
} from '@victorflow/types';
import { isoOrNull, likePattern, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService, type Trx } from '../../infra/db/db.service';
import { todayIso } from './dates';
import { validateEntryLines, type LedgerLineInput } from './ledger.validation';

export interface LedgerEntryInput {
  journalCode: string;
  /** 'YYYY-MM-DD'. Decides the fiscal year — and therefore the number — never the server clock. */
  entryDate: string;
  description: string;
  reference?: string | null;
  sourceType?: EntrySourceType;
  sourceId?: string | null;
  reversalOf?: string | null;
  lines: LedgerLineInput[];
}

export interface PostedEntry {
  id: string;
  entryNumber: string;
}

const unprocessable = (message: string, code: string, details?: Record<string, unknown>) =>
  new UnprocessableEntityException({ message, code, ...(details && { details }) });

@Injectable()
export class LedgerService {
  constructor(private readonly dbs: DbService) {}

  // ── posting ────────────────────────────────────────────────────────────────

  /** Post one entry in its own transaction. */
  post(input: LedgerEntryInput, actorId: string): Promise<PostedEntry> {
    return this.dbs.transaction((trx) => this.postInTx(trx, input, actorId));
  }

  /**
   * Post an entry inside the caller's transaction, so an invoice/payment and its ledger entry are ONE atomic unit.
   *
   * Order of operations (each step fails with a precise 422 before anything is written):
   *   1. validate the lines with scaled integers            → UNBALANCED_ENTRY / INVALID_ENTRY_LINE
   *   2. resolve journal, fiscal year (from the DATE), accounts
   *   3. insert the entry as DRAFT, insert its lines
   *   4. UPDATE … status = 'POSTED' — the DB trigger re-checks the balance, takes the next number from the
   *      per-(journal, fiscal year) SEQUENCE and, from then on, makes the entry and its lines immutable.
   */
  async postInTx(trx: Trx, input: LedgerEntryInput, actorId: string | null): Promise<PostedEntry> {
    const { lines } = validateEntryLines(input.lines);

    const journal = await trx.selectFrom('finance.journals').select(['id', 'is_active']).where('code', '=', input.journalCode).executeTakeFirst();
    if (!journal || !journal.is_active) throw unprocessable(`Unknown or inactive journal "${input.journalCode}"`, 'UNKNOWN_JOURNAL');

    const fy = await trx
      .selectFrom('finance.fiscal_years')
      .select(['id', 'code', 'status'])
      .where('start_date', '<=', input.entryDate)
      .where('end_date', '>=', input.entryDate)
      .executeTakeFirst();
    if (!fy) throw unprocessable(`No fiscal year covers ${input.entryDate}. Create one first.`, 'NO_FISCAL_YEAR');
    if (fy.status !== 'OPEN') throw unprocessable(`Fiscal year ${fy.code} is closed`, 'FISCAL_YEAR_CLOSED');

    const codes = [...new Set(lines.map((l) => l.accountCode))];
    const accounts = await trx
      .selectFrom('finance.chart_of_accounts')
      .select(['id', 'code', 'is_postable', 'is_active'])
      .where('code', 'in', codes)
      .execute();
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const unknown = codes.filter((c) => !byCode.has(c));
    if (unknown.length) throw unprocessable(`Unknown account(s): ${unknown.join(', ')}`, 'UNKNOWN_ACCOUNT');
    const unusable = codes.filter((c) => !byCode.get(c)!.is_postable || !byCode.get(c)!.is_active);
    if (unusable.length) throw unprocessable(`Account(s) not postable or inactive: ${unusable.join(', ')}`, 'ACCOUNT_NOT_POSTABLE');

    const entry = await trx
      .insertInto('finance.journal_entries')
      .values({
        journal_id: journal.id,
        fiscal_year_id: fy.id,
        entry_date: input.entryDate,
        description: input.description,
        reference: input.reference ?? null,
        source_type: input.sourceType ?? 'MANUAL',
        source_id: input.sourceId ?? null,
        reversal_of: input.reversalOf ?? null,
        created_by: actorId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('finance.journal_entry_lines')
      .values(
        lines.map((l) => ({
          entry_id: entry.id,
          account_id: byCode.get(l.accountCode)!.id,
          partner_id: l.partnerId,
          description: l.description,
          debit: formatMoney(l.debit),
          credit: formatMoney(l.credit),
        })),
      )
      .execute();

    const posted = await trx
      .updateTable('finance.journal_entries')
      .set({ status: 'POSTED', posted_by: actorId })
      .where('id', '=', entry.id)
      .returning(['id', 'entry_number'])
      .executeTakeFirstOrThrow();
    return { id: posted.id, entryNumber: posted.entry_number! };
  }

  postManual(dto: PostEntryDto, actorId: string): Promise<EntryDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const posted = await this.postInTx(trx, { ...dto, sourceType: 'MANUAL' }, actorId);
      return this.loadEntry(trx, posted.id);
    });
  }

  // ── reversal ───────────────────────────────────────────────────────────────

  /** Reverse an entry in its own transaction. */
  reverse(entryId: string, dto: ReverseEntryDto, actorId: string): Promise<EntryDetailDto> {
    return this.dbs.transaction(async (trx) => {
      const posted = await this.reverseInTx(trx, entryId, dto, actorId);
      return this.loadEntry(trx, posted.id);
    });
  }

  /**
   * A POSTED entry is never edited or deleted. "Cancelling" it posts a NEW entry whose lines are the original's
   * with debit and credit swapped, linked through reversal_of. The unique constraint on reversal_of guarantees
   * an entry can be reversed at most once.
   */
  async reverseInTx(trx: Trx, entryId: string, dto: Pick<ReverseEntryDto, 'reason' | 'entryDate'>, actorId: string | null): Promise<PostedEntry> {
    const orig = await trx
      .selectFrom('finance.journal_entries as e')
      .innerJoin('finance.journals as j', 'j.id', 'e.journal_id')
      .select(['e.id', 'e.status', 'e.entry_number', 'e.description', 'e.reference', 'e.reversal_of', 'j.code as journal_code'])
      .where('e.id', '=', entryId)
      .forUpdate()
      .executeTakeFirst();
    if (!orig) throw new NotFoundException('Journal entry not found');
    if (orig.status !== 'POSTED') throw new ConflictException({ message: 'Only POSTED entries can be reversed', code: 'NOT_POSTED' });
    if (orig.reversal_of) throw new ConflictException({ message: 'A reversing entry cannot itself be reversed', code: 'IS_REVERSAL' });

    const already = await trx.selectFrom('finance.journal_entries').select('entry_number').where('reversal_of', '=', entryId).executeTakeFirst();
    if (already) {
      throw new ConflictException({ message: `Entry ${orig.entry_number} was already reversed by ${already.entry_number}`, code: 'ALREADY_REVERSED' });
    }

    const lines = await trx
      .selectFrom('finance.journal_entry_lines as l')
      .innerJoin('finance.chart_of_accounts as a', 'a.id', 'l.account_id')
      .select(['a.code as account_code', 'l.partner_id', 'l.description', 'l.debit', 'l.credit'])
      .where('l.entry_id', '=', entryId)
      .orderBy('l.debit', 'desc')
      .orderBy('a.code')
      .execute();

    return this.postInTx(
      trx,
      {
        journalCode: orig.journal_code,
        entryDate: dto.entryDate ?? todayIso(),
        description: `Reversal of ${orig.entry_number}: ${dto.reason}`,
        reference: orig.reference,
        sourceType: 'REVERSAL',
        sourceId: orig.id,
        reversalOf: orig.id,
        lines: lines.map((l) => ({
          accountCode: l.account_code,
          debit: l.credit, // swapped
          credit: l.debit,
          partnerId: l.partner_id,
          description: l.description,
        })),
      },
      actorId,
    );
  }

  // ── queries ────────────────────────────────────────────────────────────────

  getEntry(id: string): Promise<EntryDetailDto> {
    return this.loadEntry(this.dbs.db, id);
  }

  async loadEntry(db: Kysely<Database>, id: string): Promise<EntryDetailDto> {
    const summary = await this.entryQuery(db).where('e.id', '=', id).executeTakeFirst();
    if (!summary) throw new NotFoundException('Journal entry not found');
    const lines = await db
      .selectFrom('finance.journal_entry_lines as l')
      .innerJoin('finance.chart_of_accounts as a', 'a.id', 'l.account_id')
      .leftJoin('crm.customers as c', 'c.id', 'l.partner_id')
      .select(['l.id', 'a.code as account_code', 'a.name as account_name', 'l.partner_id', 'c.name as partner_name', 'l.description', 'l.debit', 'l.credit'])
      .where('l.entry_id', '=', id)
      // lines of one entry share a created_at, so order by meaning: debits first, then credits, by account code
      .orderBy('l.debit', 'desc')
      .orderBy('a.code')
      .execute();
    return {
      ...toEntrySummary(summary),
      lines: lines.map((l) => ({
        id: l.id,
        accountCode: l.account_code,
        accountName: l.account_name,
        partnerId: l.partner_id,
        partnerName: l.partner_name,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    };
  }

  async listEntries(query: EntryListQuery): Promise<Page<EntrySummaryDto>> {
    const { n } = await this.applyEntryFilters(this.entryBase(this.dbs.db), query)
      .select(sql<string>`count(*)`.as('n'))
      .executeTakeFirstOrThrow();

    const rows = await this.withEntryColumns(this.applyEntryFilters(this.entryBase(this.dbs.db), query))
      .orderBy('e.entry_date', 'desc')
      .orderBy('e.entry_number', 'desc')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(rows.map(toEntrySummary), toCount(n), query.page, query.pageSize);
  }

  private entryBase(db: Kysely<Database>) {
    return db
      .selectFrom('finance.journal_entries as e')
      .innerJoin('finance.journals as j', 'j.id', 'e.journal_id')
      .innerJoin('finance.fiscal_years as f', 'f.id', 'e.fiscal_year_id');
  }

  private applyEntryFilters(q: ReturnType<LedgerService['entryBase']>, query: EntryListQuery) {
    let out = q;
    if (query.journal) out = out.where('j.code', '=', query.journal);
    if (query.from) out = out.where('e.entry_date', '>=', query.from);
    if (query.to) out = out.where('e.entry_date', '<=', query.to);
    if (query.search) {
      const like = likePattern(query.search);
      out = out.where((eb) => eb.or([eb('e.entry_number', 'ilike', like), eb('e.description', 'ilike', like), eb('e.reference', 'ilike', like)]));
    }
    if (query.accountCode) {
      const code = query.accountCode;
      out = out.where(
        sql<boolean>`exists (select 1 from finance.journal_entry_lines xl join finance.chart_of_accounts xa on xa.id = xl.account_id where xl.entry_id = e.id and xa.code = ${code})`,
      );
    }
    return out;
  }

  private entryQuery(db: Kysely<Database>) {
    return this.withEntryColumns(this.entryBase(db));
  }

  private withEntryColumns(q: ReturnType<LedgerService['entryBase']>) {
    return q
      .select([
        'e.id', 'e.entry_number', 'j.code as journal_code', 'f.code as fiscal_year', 'e.entry_date', 'e.description',
        'e.reference', 'e.source_type', 'e.status', 'e.reversal_of', 'e.posted_at',
        sql<string>`(select coalesce(sum(l.debit), 0)::numeric(15,4) from finance.journal_entry_lines l where l.entry_id = e.id)`.as('total_debit'),
        sql<string>`(select coalesce(sum(l.credit), 0)::numeric(15,4) from finance.journal_entry_lines l where l.entry_id = e.id)`.as('total_credit'),
        sql<string | null>`(select r.id from finance.journal_entries r where r.reversal_of = e.id)`.as('reversed_by'),
      ]);
  }

  async trialBalance(fiscalYearCode: string): Promise<TrialBalanceDto> {
    const fy = await this.dbs.db.selectFrom('finance.fiscal_years').select('id').where('code', '=', fiscalYearCode).executeTakeFirst();
    if (!fy) throw new NotFoundException(`Fiscal year ${fiscalYearCode} not found`);

    const rows = await this.dbs.db
      .selectFrom('finance.journal_entry_lines as l')
      .innerJoin('finance.journal_entries as e', 'e.id', 'l.entry_id')
      .innerJoin('finance.chart_of_accounts as a', 'a.id', 'l.account_id')
      .select([
        'a.code as account_code',
        'a.name as account_name',
        'a.account_type',
        sql<string>`sum(l.debit)::numeric(15,4)`.as('debit'),
        sql<string>`sum(l.credit)::numeric(15,4)`.as('credit'),
      ])
      .where('e.fiscal_year_id', '=', fy.id)
      .where('e.status', '=', 'POSTED')
      .groupBy(['a.code', 'a.name', 'a.account_type'])
      .orderBy('a.code')
      .execute();

    let totalDebit = 0n;
    let totalCredit = 0n;
    const out = rows.map((r) => {
      const d = parseMoney(r.debit);
      const c = parseMoney(r.credit);
      totalDebit += d;
      totalCredit += c;
      return { accountCode: r.account_code, accountName: r.account_name, accountType: r.account_type, debit: r.debit, credit: r.credit, balance: formatMoney(d - c) };
    });
    return { fiscalYear: fiscalYearCode, rows: out, totalDebit: formatMoney(totalDebit), totalCredit: formatMoney(totalCredit), balanced: totalDebit === totalCredit };
  }
}

interface EntryRow {
  id: string;
  entry_number: string | null;
  journal_code: string;
  fiscal_year: string;
  entry_date: string;
  description: string;
  reference: string | null;
  source_type: EntrySourceType;
  status: 'DRAFT' | 'POSTED';
  reversal_of: string | null;
  posted_at: Date | null;
  total_debit: string;
  total_credit: string;
  reversed_by: string | null;
}

function toEntrySummary(r: EntryRow): EntrySummaryDto {
  return {
    id: r.id,
    entryNumber: r.entry_number,
    journalCode: r.journal_code,
    fiscalYear: r.fiscal_year,
    entryDate: r.entry_date,
    description: r.description,
    reference: r.reference,
    sourceType: r.source_type,
    status: r.status,
    totalDebit: r.total_debit,
    totalCredit: r.total_credit,
    reversalOf: r.reversal_of,
    reversedBy: r.reversed_by,
    postedAt: isoOrNull(r.posted_at),
  };
}
