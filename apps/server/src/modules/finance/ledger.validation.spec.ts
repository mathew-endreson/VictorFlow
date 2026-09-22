import { UnprocessableEntityException } from '@nestjs/common';
import { validateEntryLines, type LedgerLineInput } from './ledger.validation';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof UnprocessableEntityException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
  return undefined;
};

describe('validateEntryLines (scaled-integer ledger validation)', () => {
  it('accepts a balanced entry', () => {
    const v = validateEntryLines([
      { accountCode: '411', debit: '119' },
      { accountCode: '701', credit: '100' },
      { accountCode: '44571', credit: '19' },
    ]);
    expect(v.totalDebit).toBe(1_190_000n);
    expect(v.totalCredit).toBe(1_190_000n);
  });

  it('is exact where floating point is not: 0.1 + 0.2 balances against 0.3', () => {
    expect(0.1 + 0.2 === 0.3).toBe(false); // the trap
    expect(() =>
      validateEntryLines([
        { accountCode: '512', debit: '0.1' },
        { accountCode: '530', debit: '0.2' },
        { accountCode: '701', credit: '0.3' },
      ]),
    ).not.toThrow();
  });

  it('is exact at 4 decimals and at the top of the column', () => {
    expect(() =>
      validateEntryLines([
        { accountCode: '512', debit: '99999999999.9999' },
        { accountCode: '701', credit: '99999999999.9999' },
      ]),
    ).not.toThrow();
  });

  it('rejects a one-unit-in-the-last-place imbalance with the exact figures', () => {
    try {
      validateEntryLines([
        { accountCode: '512', debit: '100.0000' },
        { accountCode: '701', credit: '99.9999' },
      ]);
      fail('expected UNBALANCED_ENTRY');
    } catch (e) {
      const body = (e as UnprocessableEntityException).getResponse() as { code: string; details: Record<string, string> };
      expect(body.code).toBe('UNBALANCED_ENTRY');
      expect(body.details).toEqual({ totalDebit: '100.0000', totalCredit: '99.9999', difference: '0.0001' });
    }
  });

  it('rejects fewer than two lines', () => {
    expect(codeOf(() => validateEntryLines([{ accountCode: '512', debit: '1' }]))).toBe('INVALID_ENTRY');
    expect(codeOf(() => validateEntryLines([]))).toBe('INVALID_ENTRY');
  });

  it('rejects a line with both sides, neither side, a negative amount, or too many decimals', () => {
    const ok = { accountCode: '701', credit: '5' };
    expect(codeOf(() => validateEntryLines([{ accountCode: '512', debit: '5', credit: '5' }, ok]))).toBe('INVALID_ENTRY_LINE');
    expect(codeOf(() => validateEntryLines([{ accountCode: '512' }, ok]))).toBe('INVALID_ENTRY_LINE');
    expect(codeOf(() => validateEntryLines([{ accountCode: '512', debit: '-5' }, ok]))).toBe('INVALID_ENTRY_LINE');
    expect(codeOf(() => validateEntryLines([{ accountCode: '512', debit: '1.23456' }, ok]))).toBe('INVALID_ENTRY_LINE');
    expect(codeOf(() => validateEntryLines([{ accountCode: '512', debit: 'abc' }, ok]))).toBe('INVALID_ENTRY_LINE');
  });

  it('rejects an amount that would overflow NUMERIC(15,4)', () => {
    expect(
      codeOf(() =>
        validateEntryLines([
          { accountCode: '512', debit: '100000000000' },
          { accountCode: '701', credit: '100000000000' },
        ]),
      ),
    ).toBe('INVALID_ENTRY_LINE');
  });

  it('a long entry with many odd amounts balances exactly (no accumulated drift)', () => {
    const lines: LedgerLineInput[] = [];
    let total = 0n;
    for (let i = 1; i <= 500; i++) {
      const cents = BigInt(i * 7919 + 13); // pseudo-random-looking, in 1/100
      total += cents;
      lines.push({ accountCode: '701', credit: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` });
    }
    lines.push({ accountCode: '411', debit: `${total / 100n}.${String(total % 100n).padStart(2, '0')}` });
    expect(() => validateEntryLines(lines)).not.toThrow();
  });
});
