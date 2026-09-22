/**
 * MVP-NOTE: the accounts and journals that invoices and payments post to are fixed here (Algerian SCF codes).
 * A finance.account_mappings table would let an accountant change them without a deploy.
 */
export const ACCOUNTS = {
  RECEIVABLES: '411', // Clients
  SALES: '701', // Ventes de produits finis
  VAT_COLLECTED: '44571', // TVA collectee 19 %
  BANK: '512',
  CASH: '530',
} as const;

export const JOURNALS = {
  SALES: 'VTE',
  BANK: 'BNQ',
  CASH: 'CAI',
} as const;

/** Days between invoice date and due date when none is given. */
export const DEFAULT_PAYMENT_TERM_DAYS = 30;
