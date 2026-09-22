import { Module } from '@nestjs/common';
import { ProductionModule } from '../production/production.module';
import { OrdersService } from './orders.service';
import { QuotesService } from './quotes.service';
import { OrdersController, QuotesController } from './sales.controller';

@Module({
  imports: [ProductionModule], // orders release to production on confirm (Production never imports Sales → no cycle)
  controllers: [QuotesController, OrdersController],
  providers: [QuotesService, OrdersService],
  exports: [OrdersService],
})
export class SalesModule {}
