import { Module } from '@nestjs/common';
import { ProductionModule } from '../production/production.module';
import { OrdersService } from './orders.service';
import { QuotesService } from './quotes.service';
import { OrdersController, QuotesController, ServicesController } from './sales.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [ProductionModule], // orders release to production on confirm (Production never imports Sales → no cycle)
  controllers: [QuotesController, OrdersController, ServicesController],
  providers: [QuotesService, OrdersService, ServicesService],
  exports: [OrdersService],
})
export class SalesModule {}
