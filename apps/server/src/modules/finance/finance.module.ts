import { Module } from '@nestjs/common';
import { ChartService } from './chart.service';
import { FinanceController } from './finance.controller';
import { InvoicesService } from './invoices.service';
import { LedgerService } from './ledger.service';

@Module({
  controllers: [FinanceController],
  providers: [ChartService, LedgerService, InvoicesService],
  exports: [LedgerService, InvoicesService],
})
export class FinanceModule {}
