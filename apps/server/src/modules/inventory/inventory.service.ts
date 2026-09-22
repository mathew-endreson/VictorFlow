import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type Database, type Kysely } from '@victorflow/db';
import {
  formatMoney,
  parseMoney,
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
  type StockMoveType,
  type TransferDto,
  type TransferResultDto,
  type UpdateItemDto,
  type UpdateWarehouseDto,
  type WarehouseDto,
} from '@victorflow/types';
import { iso, likePattern, offsetOf, toCount, toPage } from '../../common/paging';
import { DbService, type Trx } from '../../infra/db/db.service';

const toWarehouse = (w: { id: string; code: string; name: string; address: string | null; is_active: boolean }): WarehouseDto => ({
  id: w.id,
  code: w.code,
  name: w.name,
  address: w.address,
  isActive: w.is_active,
});

/** value = quantity × average cost, exact (bigint) and rounded half-up to 4 decimals. */
function stockValue(quantity: string, avgCost: string): string {
  const num = parseMoney(quantity) * parseMoney(avgCost); // scale 8
  const q = (num * 2n + 10_000n) / 20_000n; // divide by 10^4 with round-half-up
  return formatMoney(q);
}

@Injectable()
export class InventoryService {
  constructor(private readonly dbs: DbService) {}

  // ── warehouses ─────────────────────────────────────────────────────────────

  async listWarehouses(): Promise<WarehouseDto[]> {
    const rows = await this.dbs.db.selectFrom('inventory.warehouses').select(['id', 'code', 'name', 'address', 'is_active']).orderBy('code').execute();
    return rows.map(toWarehouse);
  }

  async createWarehouse(dto: CreateWarehouseDto): Promise<WarehouseDto> {
    const row = await this.dbs.transaction((trx) =>
      trx.insertInto('inventory.warehouses').values({ code: dto.code, name: dto.name, address: dto.address ?? null }).returning(['id', 'code', 'name', 'address', 'is_active']).executeTakeFirstOrThrow(),
    );
    return toWarehouse(row);
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto): Promise<WarehouseDto> {
    const patch = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.isActive !== undefined && { is_active: dto.isActive }),
    };
    const row = await this.dbs.transaction((trx) =>
      trx.updateTable('inventory.warehouses').set(patch).where('id', '=', id).returning(['id', 'code', 'name', 'address', 'is_active']).executeTakeFirst(),
    );
    if (!row) throw new NotFoundException('Warehouse not found');
    return toWarehouse(row);
  }

  // ── items ──────────────────────────────────────────────────────────────────

  private itemQuery(db: Kysely<Database>) {
    return db
      .selectFrom('inventory.items as i')
      .leftJoin('inventory.stock_levels as sl', 'sl.item_id', 'i.id')
      .select([
        'i.id', 'i.sku', 'i.name', 'i.unit', 'i.category', 'i.min_stock', 'i.is_active', 'i.custom_fields',
        sql<string>`coalesce(sum(sl.quantity), 0)::numeric(15,4)`.as('on_hand'),
      ])
      .groupBy('i.id');
  }

  private toItem(r: {
    id: string; sku: string; name: string; unit: string; category: string | null; min_stock: string; is_active: boolean;
    custom_fields: Record<string, unknown>; on_hand: string;
  }): ItemDto {
    return {
      id: r.id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      category: r.category,
      minStock: r.min_stock,
      isActive: r.is_active,
      customFields: r.custom_fields,
      onHand: r.on_hand,
      belowMin: parseMoney(r.on_hand) < parseMoney(r.min_stock),
    };
  }

  async listItems(query: ItemListQuery): Promise<Page<ItemDto>> {
    const apply = (q: ReturnType<InventoryService['itemQuery']>) => {
      let out = q;
      if (query.search) {
        const like = likePattern(query.search);
        out = out.where((eb) => eb.or([eb('i.sku', 'ilike', like), eb('i.name', 'ilike', like)]));
      }
      if (query.category) out = out.where('i.category', '=', query.category);
      if (query.isActive !== undefined) out = out.where('i.is_active', '=', query.isActive);
      if (query.belowMin) out = out.having(sql<boolean>`coalesce(sum(sl.quantity), 0) < i.min_stock`);
      return out;
    };
    const total = await this.dbs.db.selectFrom(apply(this.itemQuery(this.dbs.db)).as('x')).select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await apply(this.itemQuery(this.dbs.db)).orderBy('i.name').limit(query.pageSize).offset(offsetOf(query.page, query.pageSize)).execute();
    return toPage(rows.map((r) => this.toItem(r)), toCount(total.n), query.page, query.pageSize);
  }

  async getItem(id: string): Promise<ItemDto> {
    const r = await this.itemQuery(this.dbs.db).where('i.id', '=', id).executeTakeFirst();
    if (!r) throw new NotFoundException('Item not found');
    return this.toItem(r);
  }

  async createItem(dto: CreateItemDto): Promise<ItemDto> {
    const id = await this.dbs.transaction(async (trx) => {
      const row = await trx
        .insertInto('inventory.items')
        .values({ sku: dto.sku, name: dto.name, unit: dto.unit, category: dto.category ?? null, min_stock: dto.minStock, custom_fields: JSON.stringify(dto.customFields) })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
    return this.getItem(id);
  }

  async updateItem(id: string, dto: UpdateItemDto): Promise<ItemDto> {
    const patch = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.unit !== undefined && { unit: dto.unit }),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.minStock !== undefined && { min_stock: dto.minStock }),
      ...(dto.customFields !== undefined && { custom_fields: JSON.stringify(dto.customFields) }),
      ...(dto.isActive !== undefined && { is_active: dto.isActive }),
    };
    const res = await this.dbs.transaction((trx) => trx.updateTable('inventory.items').set(patch).where('id', '=', id).executeTakeFirst());
    if (res.numUpdatedRows === 0n) throw new NotFoundException('Item not found');
    return this.getItem(id);
  }

  // ── stock levels (the quant table — an O(1) primary-key read per item/warehouse) ─

  async listStockLevels(query: StockLevelQuery): Promise<Page<StockLevelDto>> {
    const base = (db: Kysely<Database>) =>
      db
        .selectFrom('inventory.stock_levels as sl')
        .innerJoin('inventory.items as i', 'i.id', 'sl.item_id')
        .innerJoin('inventory.warehouses as w', 'w.id', 'sl.warehouse_id');
    const apply = (q: ReturnType<typeof base>) => {
      let out = q;
      if (query.itemId) out = out.where('sl.item_id', '=', query.itemId);
      if (query.warehouseId) out = out.where('sl.warehouse_id', '=', query.warehouseId);
      if (query.belowMin) out = out.where(sql<boolean>`sl.quantity < i.min_stock`);
      if (query.search) {
        const like = likePattern(query.search);
        out = out.where((eb) => eb.or([eb('i.sku', 'ilike', like), eb('i.name', 'ilike', like)]));
      }
      return out;
    };
    const { n } = await apply(base(this.dbs.db)).select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await apply(base(this.dbs.db))
      .select(['sl.item_id', 'i.sku', 'i.name as item_name', 'i.unit', 'sl.warehouse_id', 'w.code as warehouse_code', 'sl.quantity', 'sl.avg_cost', 'i.min_stock'])
      .orderBy('i.name')
      .orderBy('w.code')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(
      rows.map((r) => ({
        itemId: r.item_id,
        sku: r.sku,
        itemName: r.item_name,
        unit: r.unit,
        warehouseId: r.warehouse_id,
        warehouseCode: r.warehouse_code,
        quantity: r.quantity,
        avgCost: r.avg_cost,
        value: stockValue(r.quantity, r.avg_cost),
        minStock: r.min_stock,
        belowMin: parseMoney(r.quantity) < parseMoney(r.min_stock),
      })),
      toCount(n),
      query.page,
      query.pageSize,
    );
  }

  // ── moves ──────────────────────────────────────────────────────────────────

  private moveQuery(db: Kysely<Database>) {
    return db
      .selectFrom('inventory.stock_moves as m')
      .innerJoin('inventory.items as i', 'i.id', 'm.item_id')
      .innerJoin('inventory.warehouses as w', 'w.id', 'm.warehouse_id')
      .select(['m.id', 'm.item_id', 'i.sku', 'i.name as item_name', 'm.warehouse_id', 'w.code as warehouse_code', 'm.move_type', 'm.quantity', 'm.unit_cost', 'm.ref_type', 'm.ref_id', 'm.note', 'm.created_at']);
  }

  private toMove(r: {
    id: string; item_id: string; sku: string; item_name: string; warehouse_id: string; warehouse_code: string; move_type: StockMoveType;
    quantity: string; unit_cost: string | null; ref_type: string | null; ref_id: string | null; note: string | null; created_at: Date;
  }): StockMoveDto {
    return {
      id: r.id,
      itemId: r.item_id,
      sku: r.sku,
      itemName: r.item_name,
      warehouseId: r.warehouse_id,
      warehouseCode: r.warehouse_code,
      type: r.move_type,
      quantity: r.quantity,
      unitCost: r.unit_cost,
      refType: r.ref_type,
      refId: r.ref_id,
      note: r.note,
      createdAt: iso(r.created_at),
    };
  }

  async listMoves(query: StockMoveListQuery): Promise<Page<StockMoveDto>> {
    const apply = (q: ReturnType<InventoryService['moveQuery']>) => {
      let out = q;
      if (query.itemId) out = out.where('m.item_id', '=', query.itemId);
      if (query.warehouseId) out = out.where('m.warehouse_id', '=', query.warehouseId);
      if (query.type) out = out.where('m.move_type', '=', query.type);
      if (query.search) {
        const like = likePattern(query.search);
        out = out.where((eb) => eb.or([eb('i.sku', 'ilike', like), eb('i.name', 'ilike', like), eb('m.note', 'ilike', like)]));
      }
      return out;
    };
    const total = await this.dbs.db.selectFrom(apply(this.moveQuery(this.dbs.db)).as('x')).select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
    const rows = await apply(this.moveQuery(this.dbs.db))
      .orderBy('m.created_at', 'desc')
      .orderBy('m.id')
      .limit(query.pageSize)
      .offset(offsetOf(query.page, query.pageSize))
      .execute();
    return toPage(rows.map((r) => this.toMove(r)), toCount(total.n), query.page, query.pageSize);
  }

  /**
   * Record a receipt, issue or adjustment. The signed quantity goes into stock_moves; a database trigger updates
   * stock_levels and the weighted-average cost in the same statement, and refuses to take stock below zero.
   */
  async recordMove(dto: StockMoveDto_In, actorId: string): Promise<StockMoveResultDto> {
    return this.dbs.transaction(async (trx) => {
      await this.assertUsable(trx, dto.itemId, dto.warehouseId);
      const signed = dto.type === 'ISSUE' ? `-${dto.quantity}` : dto.quantity;
      return this.insertMove(trx, {
        itemId: dto.itemId,
        warehouseId: dto.warehouseId,
        type: dto.type,
        quantity: signed,
        unitCost: dto.unitCost ?? null,
        refType: dto.refType ?? null,
        refId: dto.refId ?? null,
        note: dto.note ?? null,
        actorId,
      });
    });
  }

  /** Move stock between warehouses: an OUT at the source's average cost and an IN at the destination carrying that cost. */
  async transfer(dto: TransferDto, actorId: string): Promise<TransferResultDto> {
    return this.dbs.transaction(async (trx) => {
      await this.assertUsable(trx, dto.itemId, dto.fromWarehouseId);
      await this.assertUsable(trx, dto.itemId, dto.toWarehouseId);
      const refId = randomUUID();
      const out = await this.insertMove(trx, {
        itemId: dto.itemId, warehouseId: dto.fromWarehouseId, type: 'TRANSFER_OUT', quantity: `-${dto.quantity}`,
        unitCost: null, refType: 'TRANSFER', refId, note: dto.note ?? null, actorId,
      });
      const inn = await this.insertMove(trx, {
        itemId: dto.itemId, warehouseId: dto.toWarehouseId, type: 'TRANSFER_IN', quantity: dto.quantity,
        unitCost: out.move.unitCost, refType: 'TRANSFER', refId, note: dto.note ?? null, actorId,
      });
      return { out, in: inn };
    });
  }

  private async insertMove(
    trx: Trx,
    m: { itemId: string; warehouseId: string; type: StockMoveType; quantity: string; unitCost: string | null; refType: string | null; refId: string | null; note: string | null; actorId: string },
  ): Promise<StockMoveResultDto> {
    const inserted = await trx
      .insertInto('inventory.stock_moves')
      .values({
        item_id: m.itemId,
        warehouse_id: m.warehouseId,
        move_type: m.type,
        quantity: m.quantity,
        unit_cost: m.unitCost,
        ref_type: m.refType,
        ref_id: m.refId,
        note: m.note,
        created_by: m.actorId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const row = await this.moveQuery(trx).where('m.id', '=', inserted.id).executeTakeFirstOrThrow();
    const level = await trx
      .selectFrom('inventory.stock_levels')
      .select(['quantity', 'avg_cost'])
      .where('item_id', '=', m.itemId)
      .where('warehouse_id', '=', m.warehouseId)
      .executeTakeFirstOrThrow();
    return { move: this.toMove(row), level: { quantity: level.quantity, avgCost: level.avg_cost } };
  }

  private async assertUsable(trx: Trx, itemId: string, warehouseId: string): Promise<void> {
    const item = await trx.selectFrom('inventory.items').select('is_active').where('id', '=', itemId).executeTakeFirst();
    if (!item) throw new UnprocessableEntityException({ message: 'Item does not exist', code: 'UNKNOWN_ITEM' });
    if (!item.is_active) throw new UnprocessableEntityException({ message: 'Item is inactive', code: 'ITEM_INACTIVE' });
    const wh = await trx.selectFrom('inventory.warehouses').select('is_active').where('id', '=', warehouseId).executeTakeFirst();
    if (!wh) throw new UnprocessableEntityException({ message: 'Warehouse does not exist', code: 'UNKNOWN_WAREHOUSE' });
    if (!wh.is_active) throw new ConflictException({ message: 'Warehouse is inactive', code: 'WAREHOUSE_INACTIVE' });
  }
}
