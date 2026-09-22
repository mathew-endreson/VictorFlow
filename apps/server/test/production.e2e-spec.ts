import type { INestApplication } from '@nestjs/common';
import { sql } from '@victorflow/db';
import { bearer, createTestApp, dbOf, http, tokens, USERS } from './helpers/app';

type Tok = Record<'admin' | 'sales' | 'production' | 'workshop' | 'qa' | 'field', string>;

describe('P6 — config-driven production FSM + Kanban API (e2e)', () => {
  let app: INestApplication;
  let t: Tok;

  beforeAll(async () => {
    app = await createTestApp();
    t = (await tokens(app, 'admin', 'sales', 'production', 'workshop', 'qa', 'field')) as Tok;
  });
  afterAll(async () => {
    await app.close();
  });

  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const db = () => dbOf(app).db;

  /** Customer → order → CONFIRMED (which releases a production order). */
  async function released() {
    const c = (await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: `Prod Client ${uniq()}` }).expect(201)).body;
    const o = (await http(app).post('/api/v1/orders').set(bearer(t.sales)).send({ customerId: c.id, dueDate: '2026-11-30', items: [{ description: 'Enseigne', quantity: '1', unitPrice: '1000' }] }).expect(201)).body;
    const confirmed = (await http(app).post(`/api/v1/orders/${o.id}/confirm`).set(bearer(t.sales)).expect(200)).body;
    return { customer: c, order: confirmed, poId: confirmed.productionOrder.id as string };
  }

  const move = (poId: string, to: string, token: string, note?: string) =>
    http(app).post(`/api/v1/production/orders/${poId}/transition`).set(bearer(token)).send({ to, ...(note && { note }) });
  const getPo = async (poId: string, token = t.admin) => (await http(app).get(`/api/v1/production/orders/${poId}`).set(bearer(token)).expect(200)).body;
  const patchTransition = (id: string, body: object) => http(app).patch(`/api/v1/production/fsm/transitions/${id}`).set(bearer(t.admin)).send(body);

  async function transitionRow(from: string, to: string) {
    return db().selectFrom('erp.fsm_transitions').selectAll().where('from_state', '=', from).where('to_state', '=', to).executeTakeFirstOrThrow();
  }

  async function completeAllWorkOrders(poId: string) {
    const po = await getPo(poId);
    for (const wo of po.workOrders) {
      await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ status: 'COMPLETED' }).expect(200);
    }
  }

  /** Drive a fresh production order to QUALITY_CHECK with the right people. */
  async function toQualityCheck() {
    const r = await released();
    await move(r.poId, 'CONFIRMED', t.production).expect(200);
    await move(r.poId, 'IN_PRODUCTION', t.workshop).expect(200);
    await completeAllWorkOrders(r.poId);
    await move(r.poId, 'QUALITY_CHECK', t.workshop).expect(200);
    return r;
  }

  describe('confirming an order releases it to production', () => {
    it('creates a production order in the FSM initial state, with one work order per auto-create stage', async () => {
      const { order, poId } = await released();
      expect(order.productionOrder).toMatchObject({ status: 'DRAFT' });
      expect(order.productionOrder.number).toMatch(/^PRD-\d{4}-\d{6}$/);

      const po = await getPo(poId);
      expect(po).toMatchObject({ status: 'DRAFT', orderNumber: order.number, dueDate: '2026-11-30' });
      // seed: PREPRESS, PRINTING, FINISHING auto-create; INSTALLATION does not
      expect(po.workOrders.map((w: { stageCode: string }) => w.stageCode)).toEqual(['PREPRESS', 'PRINTING', 'FINISHING']);
      expect(po.workOrders.every((w: { status: string }) => w.status === 'PENDING')).toBe(true);
      expect(po.workOrders[0].title).toContain(order.number);
      expect(po.events).toHaveLength(1);
      expect(po.events[0]).toMatchObject({ fromStatus: null, toStatus: 'DRAFT' });
    });
  });

  describe('Kanban board', () => {
    it('has one column per configured state, in order, with the card in its column', async () => {
      const { poId } = await released();
      const board = (await http(app).get('/api/v1/production/board').set(bearer(t.production)).expect(200)).body;
      expect(board.columns.map((c: { code: string }) => c.code)).toEqual(['DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'COMPLETED', 'REJECTED']);
      const draft = board.columns[0];
      const card = draft.cards.find((c: { id: string }) => c.id === poId);
      expect(card).toMatchObject({ status: 'DRAFT', workOrdersTotal: 3, workOrdersCompleted: 0 });
      expect(draft).toMatchObject({ isInitial: true, label: 'Draft' });
    });

    it("cards carry only the moves THIS user may attempt (from the DB matrix + their permissions)", async () => {
      const { poId } = await released();
      const cardFor = async (token: string) => {
        const board = (await http(app).get('/api/v1/production/board').set(bearer(token)).expect(200)).body;
        return board.columns.flatMap((c: { cards: Array<{ id: string }> }) => c.cards).find((c: { id: string }) => c.id === poId);
      };
      expect((await cardFor(t.production)).allowedTransitions.map((a: { to: string }) => a.to)).toEqual(['CONFIRMED']);
      expect((await cardFor(t.admin)).allowedTransitions.map((a: { to: string }) => a.to)).toEqual(['CONFIRMED']);
      expect((await cardFor(t.sales)).allowedTransitions).toEqual([]); // may view, may not move
      expect((await cardFor(t.qa)).allowedTransitions).toEqual([]);
      await http(app).get('/api/v1/production/board').set(bearer(t.field)).expect(403);
    });
  });

  describe('transitions are validated by the server', () => {
    it('rejects an illegal transition (not in the matrix) with 409', async () => {
      const { poId } = await released();
      for (const to of ['COMPLETED', 'QUALITY_CHECK', 'IN_PRODUCTION', 'REJECTED', 'DRAFT']) {
        const res = await move(poId, to, t.admin).expect(409);
        expect(res.body.code).toBe('ILLEGAL_TRANSITION');
      }
      expect((await getPo(poId)).status).toBe('DRAFT'); // nothing moved
      await move(poId, 'NOT_A_STATE', t.admin).then((r) => expect(r.status).toBe(409)); // unknown target is just "not allowed"
      await move(poId, 'lower_case', t.admin).expect(400); // malformed at the boundary (zod)
    });

    it('enforces the PERMISSION each transition requires (403), and says which one', async () => {
      const { poId } = await released();
      const denied = await move(poId, 'CONFIRMED', t.sales).expect(403); // has production.order.read only
      expect(denied.body.code).toBe('FORBIDDEN_TRANSITION');
      expect(denied.body.message).toContain('production.order.confirm');
      await move(poId, 'CONFIRMED', t.qa).expect(403);
      await move(poId, 'CONFIRMED', t.workshop).expect(403); // workshop may START, not CONFIRM
      await move(poId, 'CONFIRMED', t.field).expect(403); // not even production.order.read
      await move(poId, 'CONFIRMED', t.production).expect(200);

      await move(poId, 'IN_PRODUCTION', t.qa).expect(403);
      await move(poId, 'IN_PRODUCTION', t.workshop).expect(200); // production.order.start ✔
      expect((await getPo(poId)).status).toBe('IN_PRODUCTION');
    });

    it('GUARD: cannot reach QUALITY_CHECK until ALL work orders are COMPLETED', async () => {
      const { poId } = await released();
      await move(poId, 'CONFIRMED', t.production).expect(200);
      await move(poId, 'IN_PRODUCTION', t.production).expect(200);

      const blocked = await move(poId, 'QUALITY_CHECK', t.production).expect(409);
      expect(blocked.body).toMatchObject({ code: 'GUARD_FAILED', guard: 'ALL_WORK_ORDERS_COMPLETED' });
      expect(blocked.body.message).toBe('3 of 3 work order(s) are not COMPLETED yet');
      expect(blocked.body.details.pending).toHaveLength(3);

      const po = await getPo(poId);
      await http(app).patch(`/api/v1/production/work-orders/${po.workOrders[0].id}`).set(bearer(t.workshop)).send({ status: 'COMPLETED' }).expect(200);
      await http(app).patch(`/api/v1/production/work-orders/${po.workOrders[1].id}`).set(bearer(t.workshop)).send({ status: 'COMPLETED' }).expect(200);
      const still = await move(poId, 'QUALITY_CHECK', t.production).expect(409);
      expect(still.body.message).toBe('1 of 3 work order(s) are not COMPLETED yet'); // 2 of 3 is not enough
      expect((await getPo(poId)).status).toBe('IN_PRODUCTION');

      await http(app).patch(`/api/v1/production/work-orders/${po.workOrders[2].id}`).set(bearer(t.workshop)).send({ status: 'COMPLETED' }).expect(200);
      const ok = await move(poId, 'QUALITY_CHECK', t.production).expect(200);
      expect(ok.body.status).toBe('QUALITY_CHECK');
    });

    it('a cancelled work order does not block the guard, but an order with NO live work orders is not vacuously "done"', async () => {
      const { poId } = await released();
      await move(poId, 'CONFIRMED', t.production).expect(200);
      await move(poId, 'IN_PRODUCTION', t.production).expect(200);
      const po = await getPo(poId);

      // cancel every work order → nothing to complete → refused (min 1)
      for (const wo of po.workOrders) await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ status: 'CANCELLED' }).expect(200);
      const none = await move(poId, 'QUALITY_CHECK', t.production).expect(409);
      expect(none.body.code).toBe('GUARD_FAILED');
      expect(none.body.message).toMatch(/needs at least 1 work order/);
    });

    it('QUALITY_CHECK → COMPLETED by QA; the sales order follows, and the history records who did what', async () => {
      const { poId, order } = await toQualityCheck();
      await move(poId, 'COMPLETED', t.production).expect(403); // production manager cannot approve
      await move(poId, 'COMPLETED', t.workshop).expect(403);
      const done = (await move(poId, 'COMPLETED', t.qa).expect(200)).body;
      expect(done.status).toBe('COMPLETED');
      expect(done.orderStatus).toBe('COMPLETED');
      expect(done.allowedTransitions).toEqual([]); // terminal

      const o = (await http(app).get(`/api/v1/orders/${order.id}`).set(bearer(t.sales)).expect(200)).body;
      expect(o).toMatchObject({ status: 'COMPLETED', productionOrder: { status: 'COMPLETED' } });

      expect(done.events.map((e: { fromStatus: string | null; toStatus: string }) => `${e.fromStatus ?? '∅'}>${e.toStatus}`)).toEqual([
        '∅>DRAFT', 'DRAFT>CONFIRMED', 'CONFIRMED>IN_PRODUCTION', 'IN_PRODUCTION>QUALITY_CHECK', 'QUALITY_CHECK>COMPLETED',
      ]);
      expect(done.events[4].actorName).toContain('Nadia'); // qa@ user
    });

    it('marks the order IN_PRODUCTION when production starts', async () => {
      const { poId, order } = await released();
      await move(poId, 'CONFIRMED', t.production).expect(200);
      expect((await http(app).get(`/api/v1/orders/${order.id}`).set(bearer(t.sales)).expect(200)).body.status).toBe('CONFIRMED');
      await move(poId, 'IN_PRODUCTION', t.production).expect(200);
      expect((await http(app).get(`/api/v1/orders/${order.id}`).set(bearer(t.sales)).expect(200)).body.status).toBe('IN_PRODUCTION');
    });

    it('REJECT needs a note; rework sends it back; only the right roles can do each step', async () => {
      const { poId } = await toQualityCheck();
      const noNote = await move(poId, 'REJECTED', t.qa).expect(422);
      expect(noNote.body.code).toBe('NOTE_REQUIRED');
      await move(poId, 'REJECTED', t.production, 'x').expect(403); // production manager may not reject

      const rejected = (await move(poId, 'REJECTED', t.qa, 'Couleurs non conformes au BAT').expect(200)).body;
      expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'Couleurs non conformes au BAT' });
      expect(rejected.events.at(-1)).toMatchObject({ toStatus: 'REJECTED', note: 'Couleurs non conformes au BAT' });

      await move(poId, 'IN_PRODUCTION', t.qa).expect(403); // rework is production.order.rework
      const rework = (await move(poId, 'IN_PRODUCTION', t.production).expect(200)).body;
      expect(rework).toMatchObject({ status: 'IN_PRODUCTION', rejectionReason: null });
    });

    it('two simultaneous moves of one card: exactly one wins, the other is refused as illegal', async () => {
      const { poId } = await released();
      await move(poId, 'CONFIRMED', t.production).expect(200);
      const [a, b] = await Promise.all([move(poId, 'IN_PRODUCTION', t.production), move(poId, 'IN_PRODUCTION', t.workshop)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const events = (await getPo(poId)).events.filter((e: { toStatus: string }) => e.toStatus === 'IN_PRODUCTION');
      expect(events).toHaveLength(1);
    });
  });

  describe('the workflow is CONFIGURATION, not code', () => {
    it('disabling a transition in the DB takes effect immediately — no deploy', async () => {
      const { poId } = await released();
      await move(poId, 'CONFIRMED', t.production).expect(200);
      const start = await transitionRow('CONFIRMED', 'IN_PRODUCTION');

      await patchTransition(start.id, { isActive: false }).expect(200);
      try {
        const res = await move(poId, 'IN_PRODUCTION', t.admin).expect(409);
        expect(res.body.code).toBe('ILLEGAL_TRANSITION');
        const board = (await http(app).get('/api/v1/production/board').set(bearer(t.admin)).expect(200)).body;
        const card = board.columns.flatMap((c: { cards: unknown[] }) => c.cards).find((c: { id: string }) => c.id === poId);
        expect(card.allowedTransitions).toEqual([]); // the board stops offering the move
      } finally {
        await patchTransition(start.id, { isActive: true }).expect(200);
      }
      await move(poId, 'IN_PRODUCTION', t.production).expect(200);
    });

    it('re-pointing the permission a transition needs changes who may perform it', async () => {
      const { poId } = await released();
      await move(poId, 'CONFIRMED', t.production).expect(200);
      const start = await transitionRow('CONFIRMED', 'IN_PRODUCTION'); // seed: production.order.start

      await patchTransition(start.id, { permissionCode: 'production.order.approve' }).expect(200); // only QA (+admin) hold it
      try {
        await move(poId, 'IN_PRODUCTION', t.production).expect(403);
        await move(poId, 'IN_PRODUCTION', t.workshop).expect(403);
        await move(poId, 'IN_PRODUCTION', t.qa).expect(200);
      } finally {
        await patchTransition(start.id, { permissionCode: 'production.order.start' }).expect(200);
      }
    });

    it('a transition added as a plain DB row works with no code change (DRAFT → REJECTED "cancel" for QA)', async () => {
      const { poId } = await released();
      await move(poId, 'REJECTED', t.qa, 'Duplicate order').expect(409); // not in the matrix yet

      const row = await db()
        .insertInto('erp.fsm_transitions')
        .values({ machine_code: 'production_order', from_state: 'DRAFT', to_state: 'REJECTED', permission_code: 'production.order.reject', label: 'Cancel', requires_note: true })
        .returning('id')
        .executeTakeFirstOrThrow();
      try {
        const res = await move(poId, 'REJECTED', t.qa, 'Duplicate order').expect(200);
        expect(res.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Duplicate order' });
      } finally {
        await db().deleteFrom('erp.fsm_transitions').where('id', '=', row.id).execute();
      }
    });

    it('guards are configurable per transition: attach one to another move and it bites; detach it and it is gone', async () => {
      const { poId } = await released();
      const confirm = await transitionRow('DRAFT', 'CONFIRMED');
      await patchTransition(confirm.id, { guardCode: 'ALL_WORK_ORDERS_COMPLETED' }).expect(200);
      try {
        const blocked = await move(poId, 'CONFIRMED', t.production).expect(409);
        expect(blocked.body).toMatchObject({ code: 'GUARD_FAILED', guard: 'ALL_WORK_ORDERS_COMPLETED' });
      } finally {
        await patchTransition(confirm.id, { guardCode: null }).expect(200);
      }
      await move(poId, 'CONFIRMED', t.production).expect(200);
    });

    it('guard parameters come from the DB row too (minWorkOrders)', async () => {
      const { poId } = await released();
      await move(poId, 'CONFIRMED', t.production).expect(200);
      await move(poId, 'IN_PRODUCTION', t.production).expect(200);
      await completeAllWorkOrders(poId);
      const qc = await transitionRow('IN_PRODUCTION', 'QUALITY_CHECK');

      await sql`update erp.fsm_transitions set guard_params = '{"minWorkOrders": 5}'::jsonb where id = ${qc.id}`.execute(db());
      try {
        const res = await move(poId, 'QUALITY_CHECK', t.production).expect(409);
        expect(res.body.message).toMatch(/at least 5 work order/);
      } finally {
        await sql`update erp.fsm_transitions set guard_params = '{}'::jsonb where id = ${qc.id}`.execute(db());
      }
      await move(poId, 'QUALITY_CHECK', t.production).expect(200);
    });

    it('exposes the live definition, validates config edits, and restricts editing to production.fsm.manage', async () => {
      const def = (await http(app).get('/api/v1/production/fsm').set(bearer(t.production)).expect(200)).body;
      expect(def.availableGuards).toContain('ALL_WORK_ORDERS_COMPLETED');
      const qc = def.transitions.find((x: { from: string; to: string }) => x.from === 'IN_PRODUCTION' && x.to === 'QUALITY_CHECK');
      expect(qc).toMatchObject({ permissionCode: 'production.order.submit_qc', guardCode: 'ALL_WORK_ORDERS_COMPLETED', isActive: true });

      await http(app).patch(`/api/v1/production/fsm/transitions/${qc.id}`).set(bearer(t.production)).send({ isActive: false }).expect(403); // read-only for them
      await patchTransition(qc.id, { guardCode: 'NO_SUCH_GUARD' }).expect(422);
      await patchTransition(qc.id, { permissionCode: 'no.such.permission' }).expect(422);
      await patchTransition(qc.id, {}).expect(400);
      await patchTransition('11111111-1111-1111-1111-111111111111', { isActive: true }).expect(404);
    });
  });

  describe('work orders', () => {
    it('start → complete stamps the times; completed work orders are final; assignment and hours are recorded', async () => {
      const { poId } = await released();
      const wo = (await getPo(poId)).workOrders[0];
      const worker = await db().selectFrom('core.users').select('id').where('email', '=', USERS.workshop).executeTakeFirstOrThrow();

      const started = (await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ status: 'IN_PROGRESS', assignedTo: worker.id }).expect(200)).body;
      expect(started).toMatchObject({ status: 'IN_PROGRESS', assignedTo: worker.id, completedAt: null });
      expect(started.startedAt).toEqual(expect.any(String));
      expect(started.assignedToName).toContain('Yacine');

      const done = (await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ status: 'COMPLETED', actualHours: '2.5' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'COMPLETED', actualHours: '2.50' });
      expect(done.completedAt).toEqual(expect.any(String));

      const reopen = await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ status: 'PENDING' }).expect(409);
      expect(reopen.body.code).toBe('INVALID_WORK_ORDER_STATE');
    });

    it('needs production.workorder.write; validates assignee and hours', async () => {
      const { poId } = await released();
      const wo = (await getPo(poId)).workOrders[0];
      await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.qa)).send({ status: 'COMPLETED' }).expect(403); // read-only
      await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ assignedTo: '11111111-1111-1111-1111-111111111111' }).expect(422);
      await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ actualHours: 'lots' }).expect(400);
      await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({}).expect(400);

      const list = (await http(app).get('/api/v1/production/work-orders').query({ productionOrderId: poId }).set(bearer(t.qa)).expect(200)).body;
      expect(list.total).toBe(3);
      expect(list.items[0]).toHaveProperty('stageName');
    });

    it("work orders are closed once the production order reaches a TERMINAL state (state flagged in config, not hardcoded)", async () => {
      const { poId } = await toQualityCheck();
      await move(poId, 'COMPLETED', t.qa).expect(200);
      const wo = (await getPo(poId)).workOrders[0];
      const res = await http(app).patch(`/api/v1/production/work-orders/${wo.id}`).set(bearer(t.workshop)).send({ actualHours: '9' }).expect(409);
      expect(res.body.code).toBe('PRODUCTION_CLOSED');
    });

    it('lists stages', async () => {
      const stages = (await http(app).get('/api/v1/production/stages').set(bearer(t.qa)).expect(200)).body;
      expect(stages.map((s: { code: string }) => s.code)).toEqual(['PREPRESS', 'PRINTING', 'FINISHING', 'INSTALLATION']);
    });
  });

  describe('cancelling a confirmed order', () => {
    it('is allowed while production has not started (production order discarded) …', async () => {
      const { poId, order } = await released();
      const cancelled = (await http(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(t.sales)).expect(200)).body;
      expect(cancelled).toMatchObject({ status: 'CANCELLED', productionOrder: null });
      await http(app).get(`/api/v1/production/orders/${poId}`).set(bearer(t.admin)).expect(404);
    });

    it('… refused once production has begun, or once the order is invoiced', async () => {
      const started = await released();
      await move(started.poId, 'CONFIRMED', t.production).expect(200);
      const res = await http(app).post(`/api/v1/orders/${started.order.id}/cancel`).set(bearer(t.sales)).expect(409);
      expect(res.body.code).toBe('PRODUCTION_STARTED');

      const invoiced = await released();
      await http(app).post(`/api/v1/finance/invoices/from-order/${invoiced.order.id}`).set(bearer(t.sales)).send({ invoiceDate: '2026-03-10' }).expect(201);
      const res2 = await http(app).post(`/api/v1/orders/${invoiced.order.id}/cancel`).set(bearer(t.sales)).expect(409);
      expect(res2.body.code).toBe('ORDER_INVOICED');
    });
  });

  it('lists production orders with status filter and search, and lets a manager adjust priority/notes', async () => {
    const { poId, order } = await released();
    const list = (await http(app).get('/api/v1/production/orders').query({ status: 'DRAFT', search: order.number }).set(bearer(t.qa)).expect(200)).body;
    expect(list.items.map((p: { id: string }) => p.id)).toEqual([poId]);
    const patched = (await http(app).patch(`/api/v1/production/orders/${poId}`).set(bearer(t.workshop)).send({ priority: 1, notes: 'Rush' }).expect(200)).body;
    expect(patched).toMatchObject({ priority: 1, notes: 'Rush' });
    await http(app).patch(`/api/v1/production/orders/${poId}`).set(bearer(t.qa)).send({ priority: 2 }).expect(403);
    await http(app).patch(`/api/v1/production/orders/${poId}`).set(bearer(t.workshop)).send({ priority: 9 }).expect(400);
  });
});
