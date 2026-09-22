import type { INestApplication } from '@nestjs/common';
import { sql } from '@victorflow/db';
import { bearer, createTestApp, dbOf, http, tokens } from './helpers/app';

describe('P7 — inventory: stock_moves → stock_levels trigger (e2e)', () => {
  let app: INestApplication;
  let t: Record<'admin' | 'workshop' | 'production' | 'qa' | 'sales', string>;
  let warehouseA: { id: string; code: string };

  beforeAll(async () => {
    app = await createTestApp();
    t = await tokens(app, 'admin', 'workshop', 'production', 'qa', 'sales');
    warehouseA = (await http(app).get('/api/v1/inventory/warehouses').set(bearer(t.admin)).expect(200)).body.find((w: { code: string }) => w.code === 'MAIN');
  });
  afterAll(async () => {
    await app.close();
  });

  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const db = () => dbOf(app).db;

  async function newItem(extra: Record<string, unknown> = {}) {
    return (await http(app).post('/api/v1/inventory/items').set(bearer(t.admin)).send({ sku: `T-${uniq()}`, name: `Test item ${uniq()}`, unit: 'm²', ...extra }).expect(201)).body as {
      id: string; sku: string; onHand: string;
    };
  }
  async function newWarehouse() {
    return (await http(app).post('/api/v1/inventory/warehouses').set(bearer(t.admin)).send({ code: `W${uniq()}`.slice(0, 18), name: `Warehouse ${uniq()}` }).expect(201)).body as { id: string; code: string };
  }

  const move = (body: Record<string, unknown>, token = t.workshop) => http(app).post('/api/v1/inventory/moves').set(bearer(token)).send(body);
  const receive = (itemId: string, quantity: string, unitCost: string, warehouseId = warehouseA.id) => move({ itemId, warehouseId, type: 'RECEIPT', quantity, unitCost });
  const issue = (itemId: string, quantity: string, warehouseId = warehouseA.id) => move({ itemId, warehouseId, type: 'ISSUE', quantity });

  async function level(itemId: string, warehouseId = warehouseA.id) {
    const res = (await http(app).get('/api/v1/inventory/stock').query({ itemId, warehouseId }).set(bearer(t.workshop)).expect(200)).body;
    return res.items[0] as { quantity: string; avgCost: string; value: string } | undefined;
  }
  const onHand = async (itemId: string) => (await http(app).get(`/api/v1/inventory/items/${itemId}`).set(bearer(t.workshop)).expect(200)).body.onHand as string;

  describe('receipt then consumption', () => {
    it('receipt 100 @ 50, issue 30 → on-hand 70; the issue is valued at the average; history is complete', async () => {
      const item = await newItem();
      expect(item.onHand).toBe('0.0000');

      const r = (await receive(item.id, '100', '50').expect(201)).body;
      expect(r.move).toMatchObject({ type: 'RECEIPT', quantity: '100.0000', unitCost: '50.0000' });
      expect(r.level).toEqual({ quantity: '100.0000', avgCost: '50.0000' });

      const i = (await issue(item.id, '30').expect(201)).body;
      expect(i.move).toMatchObject({ type: 'ISSUE', quantity: '-30.0000', unitCost: '50.0000' }); // signed, valued at average
      expect(i.level).toEqual({ quantity: '70.0000', avgCost: '50.0000' });

      expect(await level(item.id)).toMatchObject({ quantity: '70.0000', avgCost: '50.0000', value: '3500.0000' });
      expect(await onHand(item.id)).toBe('70.0000');

      const moves = (await http(app).get('/api/v1/inventory/moves').query({ itemId: item.id }).set(bearer(t.workshop)).expect(200)).body;
      expect(moves.total).toBe(2);
      expect(moves.items.map((m: { type: string }) => m.type).sort()).toEqual(['ISSUE', 'RECEIPT']);
    });

    it('weighted-average cost: 10@100 + 10@200 → 150; issue leaves it; +5@300 → 187.5', async () => {
      const item = await newItem();
      await receive(item.id, '10', '100').expect(201);
      expect((await receive(item.id, '10', '200').expect(201)).body.level).toEqual({ quantity: '20.0000', avgCost: '150.0000' });
      expect((await issue(item.id, '5').expect(201)).body.level).toEqual({ quantity: '15.0000', avgCost: '150.0000' });
      // (15 × 150 + 5 × 300) / 20 = 187.5
      expect((await receive(item.id, '5', '300').expect(201)).body.level).toEqual({ quantity: '20.0000', avgCost: '187.5000' });
    });

    it('is exact to 4 decimals (0.1 + 0.2 = 0.3, and 0.0001 units work)', async () => {
      const item = await newItem();
      await receive(item.id, '0.1', '10').expect(201);
      await receive(item.id, '0.2', '10').expect(201);
      expect(await onHand(item.id)).toBe('0.3000');
      await issue(item.id, '0.2999').expect(201);
      expect(await onHand(item.id)).toBe('0.0001');
    });

    it('keeps warehouses separate and the item total is their sum', async () => {
      const item = await newItem();
      const b = await newWarehouse();
      await receive(item.id, '40', '10', warehouseA.id).expect(201);
      await receive(item.id, '25', '20', b.id).expect(201);
      expect((await level(item.id, warehouseA.id))!.quantity).toBe('40.0000');
      expect((await level(item.id, b.id))!).toMatchObject({ quantity: '25.0000', avgCost: '20.0000' });
      expect(await onHand(item.id)).toBe('65.0000');
    });
  });

  describe('stock can never go negative', () => {
    it('refuses an issue larger than on-hand (409) and leaves stock and history untouched', async () => {
      const item = await newItem();
      await receive(item.id, '3', '10').expect(201);
      const res = await issue(item.id, '3.0001').expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.message).toMatch(/on hand 3\.0000, requested 3\.0001/);
      expect((await level(item.id))!.quantity).toBe('3.0000');
      const moves = (await http(app).get('/api/v1/inventory/moves').query({ itemId: item.id }).set(bearer(t.workshop)).expect(200)).body;
      expect(moves.total).toBe(1);
      await issue(item.id, '3').expect(201); // exactly on-hand is fine
      expect(await onHand(item.id)).toBe('0.0000');
    });

    it('concurrent issues serialise on the stock row: 5 × issue 3 against 10 on hand → exactly 3 succeed, on-hand ends at 1', async () => {
      const item = await newItem();
      await receive(item.id, '10', '5').expect(201);
      const results = await Promise.all(Array.from({ length: 5 }, () => issue(item.id, '3')));
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect((await level(item.id))!.quantity).toBe('1.0000');
    });

    it('signed adjustments: + adds, − removes, and cannot overdraw', async () => {
      const item = await newItem();
      await receive(item.id, '10', '4').expect(201);
      await move({ itemId: item.id, warehouseId: warehouseA.id, type: 'ADJUSTMENT', quantity: '2.5', note: 'found in the back' }).expect(201);
      await move({ itemId: item.id, warehouseId: warehouseA.id, type: 'ADJUSTMENT', quantity: '-4', note: 'damaged' }).expect(201);
      expect(await onHand(item.id)).toBe('8.5000');
      await move({ itemId: item.id, warehouseId: warehouseA.id, type: 'ADJUSTMENT', quantity: '-8.5001' }).expect(409);
      await move({ itemId: item.id, warehouseId: warehouseA.id, type: 'ADJUSTMENT', quantity: '0' }).expect(400);
    });
  });

  describe('the quant table always equals the move history', () => {
    it('for every (item, warehouse), stock_levels.quantity = Σ stock_moves.quantity', async () => {
      // exercise a mix, including a failed move and a transfer
      const item = await newItem();
      const b = await newWarehouse();
      await receive(item.id, '50', '10').expect(201);
      await issue(item.id, '7').expect(201);
      await issue(item.id, '1000').expect(409);
      await http(app).post('/api/v1/inventory/transfers').set(bearer(t.workshop)).send({ itemId: item.id, fromWarehouseId: warehouseA.id, toWarehouseId: b.id, quantity: '12' }).expect(201);
      await move({ itemId: item.id, warehouseId: b.id, type: 'ADJUSTMENT', quantity: '-2' }).expect(201);

      const drift = await sql<{ item_id: string; warehouse_id: string; level: string; moves: string }>`
        select l.item_id, l.warehouse_id, l.quantity::text as level, coalesce(sum(m.quantity), 0)::text as moves
          from inventory.stock_levels l
          left join inventory.stock_moves m on m.item_id = l.item_id and m.warehouse_id = l.warehouse_id
         group by l.item_id, l.warehouse_id, l.quantity
        having l.quantity <> coalesce(sum(m.quantity), 0)`.execute(db());
      expect(drift.rows).toEqual([]); // across the WHOLE database, not just this item

      expect((await level(item.id, warehouseA.id))!.quantity).toBe('31.0000'); // 50 − 7 − 12
      expect((await level(item.id, b.id))!.quantity).toBe('10.0000'); // +12 − 2
    });

    it('moves are append-only at the database (UPDATE / DELETE / TRUNCATE all rejected)', async () => {
      const item = await newItem();
      await receive(item.id, '5', '5').expect(201);
      await expect(db().updateTable('inventory.stock_moves').set({ note: 'edited' }).where('item_id', '=', item.id).execute()).rejects.toMatchObject({ code: 'VF001' });
      await expect(db().deleteFrom('inventory.stock_moves').where('item_id', '=', item.id).execute()).rejects.toMatchObject({ code: 'VF001' });
      await expect(sql`truncate inventory.stock_moves`.execute(db())).rejects.toMatchObject({ code: 'VF001' });
      expect((await level(item.id))!.quantity).toBe('5.0000');
    });
  });

  describe('transfers', () => {
    it('moves stock between warehouses, carrying the average cost, as a linked pair of moves', async () => {
      const item = await newItem();
      const b = await newWarehouse();
      await receive(item.id, '10', '100').expect(201);
      await receive(item.id, '10', '200').expect(201); // avg 150 at A

      const res = (await http(app).post('/api/v1/inventory/transfers').set(bearer(t.workshop)).send({ itemId: item.id, fromWarehouseId: warehouseA.id, toWarehouseId: b.id, quantity: '8', note: 'to the annex' }).expect(201)).body;
      expect(res.out).toMatchObject({ move: { type: 'TRANSFER_OUT', quantity: '-8.0000', unitCost: '150.0000' }, level: { quantity: '12.0000', avgCost: '150.0000' } });
      expect(res.in).toMatchObject({ move: { type: 'TRANSFER_IN', quantity: '8.0000', unitCost: '150.0000' }, level: { quantity: '8.0000', avgCost: '150.0000' } });
      expect(res.out.move.refId).toBe(res.in.move.refId);
      expect(await onHand(item.id)).toBe('20.0000'); // total unchanged
    });

    it('is all-or-nothing: an oversized transfer changes nothing at either end', async () => {
      const item = await newItem();
      const b = await newWarehouse();
      await receive(item.id, '5', '10').expect(201);
      const res = await http(app).post('/api/v1/inventory/transfers').set(bearer(t.workshop)).send({ itemId: item.id, fromWarehouseId: warehouseA.id, toWarehouseId: b.id, quantity: '6' }).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect((await level(item.id, warehouseA.id))!.quantity).toBe('5.0000');
      expect(await level(item.id, b.id)).toBeUndefined();
    });

    it('refuses transferring to the same warehouse (400)', async () => {
      const item = await newItem();
      await http(app).post('/api/v1/inventory/transfers').set(bearer(t.workshop)).send({ itemId: item.id, fromWarehouseId: warehouseA.id, toWarehouseId: warehouseA.id, quantity: '1' }).expect(400);
    });
  });

  describe('validation', () => {
    it('rejects malformed moves at the boundary', async () => {
      const item = await newItem();
      const base = { itemId: item.id, warehouseId: warehouseA.id };
      await move({ ...base, type: 'RECEIPT', quantity: 5, unitCost: '10' }).expect(400); // number, not string
      await move({ ...base, type: 'RECEIPT', quantity: '5' }).expect(400); // receipt without cost
      await move({ ...base, type: 'RECEIPT', quantity: '-5', unitCost: '10' }).expect(400);
      await move({ ...base, type: 'RECEIPT', quantity: '0', unitCost: '10' }).expect(400);
      await move({ ...base, type: 'ISSUE', quantity: '-5' }).expect(400); // direction comes from the type
      await move({ ...base, type: 'ISSUE', quantity: '1', unitCost: '5' }).expect(400); // issues are valued by the system
      await move({ ...base, type: 'RECEIPT', quantity: '1.00001', unitCost: '1' }).expect(400);
      await move({ ...base, type: 'TRANSFER_IN', quantity: '1' }).expect(400); // transfers have their own endpoint
    });

    it('refuses unknown or inactive items and warehouses', async () => {
      const item = await newItem();
      const ghost = '11111111-1111-1111-1111-111111111111';
      expect((await receive(ghost, '1', '1').expect(422)).body.code).toBe('UNKNOWN_ITEM');
      expect((await receive(item.id, '1', '1', ghost).expect(422)).body.code).toBe('UNKNOWN_WAREHOUSE');

      await http(app).patch(`/api/v1/inventory/items/${item.id}`).set(bearer(t.admin)).send({ isActive: false }).expect(200);
      expect((await receive(item.id, '1', '1').expect(422)).body.code).toBe('ITEM_INACTIVE');

      const w = await newWarehouse();
      const item2 = await newItem();
      await http(app).patch(`/api/v1/inventory/warehouses/${w.id}`).set(bearer(t.admin)).send({ isActive: false }).expect(200);
      expect((await receive(item2.id, '1', '1', w.id).expect(409)).body.code).toBe('WAREHOUSE_INACTIVE');
    });

    it('SKUs and warehouse codes are unique (409) and normalised to upper case', async () => {
      const sku = `dup-${uniq()}`;
      const a = (await http(app).post('/api/v1/inventory/items').set(bearer(t.admin)).send({ sku, name: 'First one' }).expect(201)).body;
      expect(a.sku).toBe(sku.toUpperCase());
      await http(app).post('/api/v1/inventory/items').set(bearer(t.admin)).send({ sku: sku.toUpperCase(), name: 'Second one' }).expect(409);
      await http(app).post('/api/v1/inventory/warehouses').set(bearer(t.admin)).send({ code: 'main', name: 'Another main' }).expect(409);
    });
  });

  describe('reads', () => {
    it('flags low stock and filters on it', async () => {
      const low = await newItem({ minStock: '20' });
      const fine = await newItem({ minStock: '5' });
      await receive(low.id, '8', '10').expect(201);
      await receive(fine.id, '8', '10').expect(201);

      const items = (await http(app).get('/api/v1/inventory/items').query({ belowMin: 'true', pageSize: 200 }).set(bearer(t.workshop)).expect(200)).body;
      const ids = items.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(low.id);
      expect(ids).not.toContain(fine.id);
      expect(items.items.find((i: { id: string }) => i.id === low.id)).toMatchObject({ belowMin: true, onHand: '8.0000', minStock: '20.0000' });

      const stock = (await http(app).get('/api/v1/inventory/stock').query({ belowMin: 'true', itemId: low.id }).set(bearer(t.workshop)).expect(200)).body;
      expect(stock.total).toBe(1);
      expect(stock.items[0]).toMatchObject({ belowMin: true, value: '80.0000' });
    });

    it('searches items and custom fields round-trip', async () => {
      const marker = `Marker${uniq()}`;
      const item = await newItem({ name: `${marker} vinyl`, category: 'consumable', customFields: { supplier: 'Sarl Papyrus', leadDays: 12 } });
      const found = (await http(app).get('/api/v1/inventory/items').query({ search: marker }).set(bearer(t.workshop)).expect(200)).body;
      expect(found.items.map((i: { id: string }) => i.id)).toEqual([item.id]);
      expect(found.items[0]).toMatchObject({ category: 'consumable', customFields: { supplier: 'Sarl Papyrus', leadDays: 12 } });
    });

    it('the seeded demo stock is there', async () => {
      const items = (await http(app).get('/api/v1/inventory/items').query({ search: 'VIN-ADH-BL' }).set(bearer(t.workshop)).expect(200)).body;
      expect(items.items[0]).toMatchObject({ sku: 'VIN-ADH-BL', onHand: '120.0000' });
    });
  });

  describe('permissions', () => {
    it('workshop/production may move stock; QA and sales may not even read it; only admin manages items', async () => {
      const item = await newItem();
      await receive(item.id, '5', '5').expect(201); // workshop: inventory.stock.move
      await move({ itemId: item.id, warehouseId: warehouseA.id, type: 'ISSUE', quantity: '1' }, t.production).expect(201);

      await http(app).get('/api/v1/inventory/stock').set(bearer(t.qa)).expect(403);
      await http(app).get('/api/v1/inventory/items').set(bearer(t.sales)).expect(403);
      await move({ itemId: item.id, warehouseId: warehouseA.id, type: 'ISSUE', quantity: '1' }, t.qa).expect(403);
      await http(app).post('/api/v1/inventory/items').set(bearer(t.workshop)).send({ sku: `NOPE-${uniq()}`, name: 'Not allowed' }).expect(403); // no inventory.item.write
      await http(app).post('/api/v1/inventory/warehouses').set(bearer(t.production)).send({ code: 'ZZ', name: 'Nope' }).expect(403);
      await http(app).get('/api/v1/inventory/stock').expect(401);
    });

    it('records who made each move in the audit trail', async () => {
      const item = await newItem();
      const res = (await receive(item.id, '5', '5').expect(201)).body;
      const workshopUser = await db().selectFrom('core.users').select('id').where('email', '=', 'workshop@victorflow.local').executeTakeFirstOrThrow();
      const trail = await db().selectFrom('audit.trail').select('actor_id').where('table_name', '=', 'stock_moves').where('row_id', '=', res.move.id).executeTakeFirstOrThrow();
      expect(trail.actor_id).toBe(workshopUser.id);
    });
  });
});
