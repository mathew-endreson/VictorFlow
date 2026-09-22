import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  cancelInvoiceSchema,
  createAccountSchema,
  createFiscalYearSchema,
  createInvoiceSchema,
  entryListQuerySchema,
  invoiceListQuerySchema,
  paymentListQuerySchema,
  PERMISSIONS,
  postEntrySchema,
  recordPaymentSchema,
  reverseEntrySchema,
  trialBalanceQuerySchema,
  type AccountDto,
  type CancelInvoiceDto,
  type CreateAccountDto,
  type CreateFiscalYearDto,
  type CreateInvoiceDto,
  type EntryDetailDto,
  type EntryListQuery,
  type EntrySummaryDto,
  type FiscalYearDto,
  type InvoiceDetailDto,
  type InvoiceListQuery,
  type InvoiceSummaryDto,
  type JournalDto,
  type Page,
  type PaymentDto,
  type PaymentListQuery,
  type PostEntryDto,
  type RecordPaymentDto,
  type ReverseEntryDto,
  type TrialBalanceDto,
  type TrialBalanceQuery,
} from '@victorflow/types';
import { CurrentUser, RequirePermissions, type Principal, RequiresFeature } from '../../common/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/zod.pipe';
import { ChartService } from './chart.service';
import { InvoicesService } from './invoices.service';
import { LedgerService } from './ledger.service';

@RequiresFeature('finance')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly chart: ChartService,
    private readonly ledger: LedgerService,
    private readonly invoices: InvoicesService,
  ) {}

  // ── chart of accounts, journals, fiscal years ──────────────────────────────

  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNT_READ)
  @Get('accounts')
  accounts(): Promise<AccountDto[]> {
    return this.chart.listAccounts();
  }

  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNT_WRITE)
  @Post('accounts')
  createAccount(@ZBody(createAccountSchema) dto: CreateAccountDto): Promise<AccountDto> {
    return this.chart.createAccount(dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNT_READ)
  @Get('journals')
  journals(): Promise<JournalDto[]> {
    return this.chart.listJournals();
  }

  @RequirePermissions(PERMISSIONS.FINANCE_ACCOUNT_READ)
  @Get('fiscal-years')
  fiscalYears(): Promise<FiscalYearDto[]> {
    return this.chart.listFiscalYears();
  }

  @RequirePermissions(PERMISSIONS.FINANCE_FISCALYEAR_MANAGE)
  @Post('fiscal-years')
  createFiscalYear(@ZBody(createFiscalYearSchema) dto: CreateFiscalYearDto): Promise<FiscalYearDto> {
    return this.chart.createFiscalYear(dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_FISCALYEAR_MANAGE)
  @Post('fiscal-years/:id/close')
  @HttpCode(200)
  closeFiscalYear(@IdParam() id: string): Promise<FiscalYearDto> {
    return this.chart.closeFiscalYear(id);
  }

  // ── ledger ─────────────────────────────────────────────────────────────────

  @RequirePermissions(PERMISSIONS.FINANCE_ENTRY_READ)
  @Get('entries')
  entries(@ZQuery(entryListQuerySchema) query: EntryListQuery): Promise<Page<EntrySummaryDto>> {
    return this.ledger.listEntries(query);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_ENTRY_READ)
  @Get('entries/:id')
  entry(@IdParam() id: string): Promise<EntryDetailDto> {
    return this.ledger.getEntry(id);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_ENTRY_POST)
  @Post('entries')
  postEntry(@ZBody(postEntrySchema) dto: PostEntryDto, @CurrentUser() user: Principal): Promise<EntryDetailDto> {
    return this.ledger.postManual(dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_ENTRY_REVERSE)
  @Post('entries/:id/reverse')
  reverseEntry(@IdParam() id: string, @ZBody(reverseEntrySchema) dto: ReverseEntryDto, @CurrentUser() user: Principal): Promise<EntryDetailDto> {
    return this.ledger.reverse(id, dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_ENTRY_READ)
  @Get('trial-balance')
  trialBalance(@ZQuery(trialBalanceQuerySchema) query: TrialBalanceQuery): Promise<TrialBalanceDto> {
    return this.ledger.trialBalance(query.fiscalYear);
  }

  // ── invoices & payments ────────────────────────────────────────────────────

  @RequirePermissions(PERMISSIONS.FINANCE_INVOICE_READ)
  @Get('invoices')
  invoiceList(@ZQuery(invoiceListQuerySchema) query: InvoiceListQuery): Promise<Page<InvoiceSummaryDto>> {
    return this.invoices.list(query);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_INVOICE_READ)
  @Get('invoices/:id')
  invoice(@IdParam() id: string): Promise<InvoiceDetailDto> {
    return this.invoices.get(id);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_INVOICE_CREATE)
  @Post('invoices/from-order/:orderId')
  createInvoice(
    @IdParam('orderId') orderId: string,
    @ZBody(createInvoiceSchema) dto: CreateInvoiceDto,
    @CurrentUser() user: Principal,
  ): Promise<InvoiceDetailDto> {
    return this.invoices.createFromOrder(orderId, dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_INVOICE_CANCEL)
  @Post('invoices/:id/cancel')
  @HttpCode(200)
  cancelInvoice(@IdParam() id: string, @ZBody(cancelInvoiceSchema) dto: CancelInvoiceDto, @CurrentUser() user: Principal): Promise<InvoiceDetailDto> {
    return this.invoices.cancel(id, dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENT_RECORD)
  @Post('invoices/:id/payments')
  recordPayment(@IdParam() id: string, @ZBody(recordPaymentSchema) dto: RecordPaymentDto, @CurrentUser() user: Principal): Promise<InvoiceDetailDto> {
    return this.invoices.recordPayment(id, dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENT_READ)
  @Get('payments')
  payments(@ZQuery(paymentListQuerySchema) query: PaymentListQuery): Promise<Page<PaymentDto>> {
    return this.invoices.listPayments(query);
  }
}
