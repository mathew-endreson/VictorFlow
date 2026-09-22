import { UnprocessableEntityException } from '@nestjs/common';
import { formatMoney, parseMoney } from '@victorflow/types';

export interface LedgerLineInput {
  accountCode: string;
  /** Decimal string; omitted = 0. Never a number. */
  debit?: string;
  credit?: string;
  partnerId?: string | null;
  description?: string | null;
}

export interface ValidatedLine {
  accountCode: string;
  debit: bigint;
  credit: bigint;
  partnerId: string | null;
  description: string | null;
}

export interface ValidatedLines {
  lines: ValidatedLine[];
  totalDebit: bigint;
  totalCredit: bigint;
}

/** Largest value NUMERIC(15,4) can hold, as a scaled integer (11 integer digits + 4 decimals). */
const MAX_SCALED = 99_999_999_999_9999n;

const invalid = (message: string, code: string, details?: Record<string, unknown>) =>
  new UnprocessableEntityException({ message, code, ...(details && { details }) });

/**
 * Validates a set of journal lines using SCALED INTEGERS (bigint, 10^-4 units) — never floats — so
 * 0.1 + 0.2 = 0.3 holds exactly. Rules: at least two lines; each line has exactly one non-zero side, ≥ 0;
 * every amount fits the column; total debit equals total credit.
 *
 * The database re-checks the same invariants in a trigger; this runs first to give a precise error message.
 */
export function validateEntryLines(input: readonly LedgerLineInput[]): ValidatedLines {
  if (input.length < 2) throw invalid('A journal entry needs at least two lines', 'INVALID_ENTRY');

  let totalDebit = 0n;
  let totalCredit = 0n;
  const lines = input.map((l, i): ValidatedLine => {
    const n = i + 1;
    let debit: bigint;
    let credit: bigint;
    try {
      debit = parseMoney(l.debit ?? '0');
      credit = parseMoney(l.credit ?? '0');
    } catch (e) {
      throw invalid(`Line ${n}: ${(e as Error).message}`, 'INVALID_ENTRY_LINE');
    }
    if (debit < 0n || credit < 0n) throw invalid(`Line ${n}: amounts cannot be negative`, 'INVALID_ENTRY_LINE');
    if (debit > MAX_SCALED || credit > MAX_SCALED) throw invalid(`Line ${n}: amount is too large`, 'INVALID_ENTRY_LINE');
    if (debit === 0n && credit === 0n) throw invalid(`Line ${n}: needs a debit or a credit amount`, 'INVALID_ENTRY_LINE');
    if (debit > 0n && credit > 0n) throw invalid(`Line ${n}: cannot have both a debit and a credit`, 'INVALID_ENTRY_LINE');
    totalDebit += debit;
    totalCredit += credit;
    return { accountCode: l.accountCode, debit, credit, partnerId: l.partnerId ?? null, description: l.description ?? null };
  });

  if (totalDebit !== totalCredit) {
    const diff = totalDebit - totalCredit;
    throw invalid(
      `Unbalanced entry: total debit ${formatMoney(totalDebit)} ≠ total credit ${formatMoney(totalCredit)}`,
      'UNBALANCED_ENTRY',
      {
        totalDebit: formatMoney(totalDebit),
        totalCredit: formatMoney(totalCredit),
        difference: formatMoney(diff < 0n ? -diff : diff),
      },
    );
  }
  return { lines, totalDebit, totalCredit };
}
