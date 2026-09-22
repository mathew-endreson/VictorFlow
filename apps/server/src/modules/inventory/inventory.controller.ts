import { Controller, Get, Patch, Post } from '@nestjs/common';
import {
  createItemSchema,
  createWarehouseSchema,
  itemListQuerySchema,
  PERMISSIONS,
  stockLevelQuerySchema,
  stockMoveListQuerySchema,
  stockMoveSchema,
  transferSchema,
  updateItemSchema,
  updateWarehouseSchema,
  type CreateItemDto,
  type CreateWarehouseDto,
  type ItemDto,
  type ItemListQuery,
  type Page,
  type StockLevelDto,
  type StockLevelQuery,
  type StockMoveDto,
  type StockMoveDto_In,
  type StockMoveListQuery,
  type StockMoveResultDto,
  type TransferDto,
  type TransferResultDto,
  type UpdateItemDto,
  type UpdateWarehouseDto,
  type WarehouseDto,
} from '@victorflow/types';
import { CurrentUser, RequirePermissions, type Principal, RequiresFeature } from '../../common/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/zod.pipe';
import { InventoryService } from './inventory.service';

@RequiresFeature('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_WAREHOUSE_READ)
  @Get('warehouses')
  warehouses(): Promise<WarehouseDto[]> {
    return this.inventory.listWarehouses();
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_WAREHOUSE_WRITE)
  @Post('warehouses')
  createWarehouse(@ZBody(createWarehouseSchema) dto: CreateWarehouseDto): Promise<WarehouseDto> {
    return this.inventory.createWarehouse(dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_WAREHOUSE_WRITE)
  @Patch('warehouses/:id')
  updateWarehouse(@IdParam() id: string, @ZBody(updateWarehouseSchema) dto: UpdateWarehouseDto): Promise<WarehouseDto> {
    return this.inventory.updateWarehouse(id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ITEM_READ)
  @Get('items')
  items(@ZQuery(itemListQuerySchema) query: ItemListQuery): Promise<Page<ItemDto>> {
    return this.inventory.listItems(query);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ITEM_READ)
  @Get('items/:id')
  item(@IdParam() id: string): Promise<ItemDto> {
    return this.inventory.getItem(id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ITEM_WRITE)
  @Post('items')
  createItem(@ZBody(createItemSchema) dto: CreateItemDto): Promise<ItemDto> {
    return this.inventory.createItem(dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ITEM_WRITE)
  @Patch('items/:id')
  updateItem(@IdParam() id: string, @ZBody(updateItemSchema) dto: UpdateItemDto): Promise<ItemDto> {
    return this.inventory.updateItem(id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_STOCK_READ)
  @Get('stock')
  stock(@ZQuery(stockLevelQuerySchema) query: StockLevelQuery): Promise<Page<StockLevelDto>> {
    return this.inventory.listStockLevels(query);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_STOCK_READ)
  @Get('moves')
  moves(@ZQuery(stockMoveListQuerySchema) query: StockMoveListQuery): Promise<Page<StockMoveDto>> {
    return this.inventory.listMoves(query);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_STOCK_MOVE)
  @Post('moves')
  move(@ZBody(stockMoveSchema) dto: StockMoveDto_In, @CurrentUser() user: Principal): Promise<StockMoveResultDto> {
    return this.inventory.recordMove(dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_STOCK_MOVE)
  @Post('transfers')
  transfer(@ZBody(transferSchema) dto: TransferDto, @CurrentUser() user: Principal): Promise<TransferResultDto> {
    return this.inventory.transfer(dto, user.id);
  }
}
