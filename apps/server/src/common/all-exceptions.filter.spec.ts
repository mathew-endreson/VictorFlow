import { mapPgError } from './all-exceptions.filter';

const pg = (code: string, message = 'db message') => ({ code, message, severity: 'ERROR' });

describe('mapPgError', () => {
  it.each([
    ['VF001', 409, 'IMMUTABLE_RECORD'],
    ['VF002', 422, 'INVALID_JOURNAL_ENTRY'],
    ['VF003', 422, 'FISCAL_YEAR'],
    ['VF004', 409, 'INSUFFICIENT_STOCK'],
    ['23505', 409, 'DUPLICATE'],
    ['23503', 409, 'REFERENCE_VIOLATION'],
    ['23514', 422, 'CHECK_VIOLATION'],
    ['22P02', 400, 'INVALID_INPUT'],
    ['23P01', 409, 'OVERLAP'],
    ['40P01', 503, 'RETRY'],
  ])('%s → %i %s', (code, status, mapped) => {
    expect(mapPgError(pg(code))).toMatchObject({ status, code: mapped });
  });

  it('passes our own trigger messages through (they are written for humans)', () => {
    expect(mapPgError(pg('VF002', 'Unbalanced journal entry: debit 100 <> credit 99')).message).toBe(
      'Unbalanced journal entry: debit 100 <> credit 99',
    );
  });

  it('never leaks internal details for unknown errors', () => {
    const m = mapPgError(pg('XX000', 'relation "core.users" does not exist at character 15'));
    expect(m.status).toBe(500);
    expect(m.message).toBe('Internal server error');
  });

  it('does not echo constraint or value details for unique violations', () => {
    const m = mapPgError({ ...pg('23505', 'duplicate key value violates unique constraint "users_email_lower_uq"'), constraint: 'users_email_lower_uq' });
    expect(m.message).not.toContain('users_email_lower_uq');
  });
});
