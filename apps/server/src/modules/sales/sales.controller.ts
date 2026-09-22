import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  createOrderSchema,
  createQuoteSchema,
  orderListQuerySchema,
  PERMISSIONS,
  quoteListQuerySchema,
  updateOrderSchema,
  updateQuoteSchema,
  type CreateOrderDto,
  type CreateQuoteDto,
  type OrderDetailDto,
  type OrderListQuery,
  type OrderSummaryDto,
  type Page,
  type QuoteDetailDto,
  type QuoteListQuery,
  type QuoteSummaryDto,
  type UpdateOrderDto,
  type UpdateQuoteDto,
} from '@victorflow/types';
import { CurrentUser, RequirePermissions, type Principal, RequiresFeature } from '../../common/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/zod.pipe';
import { OrdersService } from './orders.service';
import { QuotesService } from './quotes.service';

@RequiresFeature('sales')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @RequirePermissions(PERMISSIONS.SALES_QUOTE_READ)
  @Get()
  list(@ZQuery(quoteListQuerySchema) query: QuoteListQuery): Promise<Page<QuoteSummaryDto>> {
    return this.quotes.list(query);
  }

  @RequirePermissions(PERMISSIONS.SALES_QUOTE_READ)
  @Get(':id')
  get(@IdParam() id: string): Promise<QuoteDetailDto> {
    return this.quotes.get(id);
  }

  @RequirePermissions(PERMISSIONS.SALES_QUOTE_WRITE)
  @Post()
  create(@ZBody(createQuoteSchema) dto: CreateQuoteDto, @CurrentUser() user: Principal): Promise<QuoteDetailDto> {
    return this.quotes.create(dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.SALES_QUOTE_WRITE)
  @Patch(':id')
  update(@IdParam() id: string, @ZBody(updateQuoteSchema) dto: UpdateQuoteDto): Promise<QuoteDetailDto> {
    return this.quotes.update(id, dto);
  }

  @RequirePermissions(PERMISSIONS.SALES_QUOTE_WRITE)
  @Post(':id/send')
  @HttpCode(200)
  send(@IdParam() id: string): Promise<QuoteDetailDto> {
    return this.quotes.send(id);
  }

  @RequirePermissions(PERMISSIONS.SALES_QUOTE_WRITE)
  @Post(':id/accept')
  @HttpCode(200)
  accept(@IdParam() id: string): Promise<QuoteDetailDto> {
    return this.quotes.accept(id);
  }

  @RequirePermissions(PERMISSIONS.SALES_QUOTE_WRITE)
  @Post(':id/reject')
  @HttpCode(200)
  reject(@IdParam() id: string): Promise<QuoteDetailDto> {
    return this.quotes.reject(id);
  }

  @RequirePermissions(PERMISSIONS.SALES_QUOTE_CONVERT)
  @Post(':id/convert')
  convert(@IdParam() id: string, @CurrentUser() user: Principal): Promise<OrderDetailDto> {
    return this.quotes.convert(id, user.id);
  }
}

@RequiresFeature('sales')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequirePermissions(PERMISSIONS.SALES_ORDER_READ)
  @Get()
  list(@ZQuery(orderListQuerySchema) query: OrderListQuery): Promise<Page<OrderSummaryDto>> {
    return this.orders.list(query);
  }

  @RequirePermissions(PERMISSIONS.SALES_ORDER_READ)
  @Get(':id')
  get(@IdParam() id: string): Promise<OrderDetailDto> {
    return this.orders.get(id);
  }

  @RequirePermissions(PERMISSIONS.SALES_ORDER_WRITE)
  @Post()
  create(@ZBody(createOrderSchema) dto: CreateOrderDto, @CurrentUser() user: Principal): Promise<OrderDetailDto> {
    return this.orders.create(dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.SALES_ORDER_WRITE)
  @Patch(':id')
  update(@IdParam() id: string, @ZBody(updateOrderSchema) dto: UpdateOrderDto): Promise<OrderDetailDto> {
    return this.orders.update(id, dto);
  }

  @RequirePermissions(PERMISSIONS.SALES_ORDER_CONFIRM)
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@IdParam() id: string, @CurrentUser() user: Principal): Promise<OrderDetailDto> {
    return this.orders.confirm(id, user.id);
  }

  @RequirePermissions(PERMISSIONS.SALES_ORDER_CANCEL)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@IdParam() id: string): Promise<OrderDetailDto> {
    return this.orders.cancel(id);
  }
}
