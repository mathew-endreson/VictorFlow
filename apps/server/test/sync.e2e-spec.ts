import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { sql } from '@victorflow/db';
import type { SyncChange, SyncMutationResult, TaskDto } from '@victorflow/types';
import { bearer, createTestApp, dbOf, http, login, tokens, USERS } from './helpers/app';

// A real 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('P8 — sync push/pull (idempotency + change_seq + OCC) and proofs (e2e)', () => {
  let app: INestApplication;
  let t: Record<'admin' | 'sales' | 'workshop' | 'field', string>;
  let fieldId: string;
  let workshopId: string;

  beforeAll(async () => {
    app = await createTestApp();
    t = await tokens(app, 'admin', 'sales', 'workshop', 'field');
    const users = await dbOf(app).db.selectFrom('core.users').select(['id', 'email']).execute();
    fieldId = users.find((u) => u.email === USERS.field)!.id;
    workshopId = users.find((u) => u.email === USERS.workshop)!.id;
  });
  afterAll(async () => {
    await app.close();
  });

  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const db = () => dbOf(app).db;

  async function newTask(assignedTo: string | null = fieldId, extra: Record<string, unknown> = {}): Promise<TaskDto> {
    return (await http(app).post('/api/v1/workforce/tasks').set(bearer(t.workshop)).send({ title: `Sync task ${uniq()}`, assignedTo, ...extra }).expect(201)).body;
  }

  const mut = (taskId: string, baseVersion: number, changes: Record<string, unknown>, key = `key-${uniq()}`) => ({
    idempotencyKey: key,
    entity: 'task',
    op: 'update',
    entityId: taskId,
    baseVersion,
    changes,
  });
  const push = (token: string, mutations: unknown[], deviceId = 'device-A') => http(app).post('/api/v1/sync/push').set(bearer(token)).send({ deviceId, mutations });
  const pull = (token: string, cursor = '0', limit?: number) =>
    http(app).get('/api/v1/sync/pull').query({ cursor, ...(limit !== undefined && { limit }) }).set(bearer(token));
  const one = async (token: string, m: unknown): Promise<SyncMutationResult> => (await push(token, [m]).expect(200)).body.results[0];
  const dbTask = (id: string) => db().selectFrom('workforce.tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  /** Everything a device would learn from cursor `from` onwards, following hasMore. */
  async function pullAll(token: string, from = '0', limit = 50) {
    const changes: SyncChange[] = [];
    let cursor = from;
    for (let i = 0; i < 100; i++) {
      const res = (await pull(token, cursor, limit).expect(200)).body;
      changes.push(...res.changes);
      cursor = res.nextCursor;
      if (!res.hasMore) return { changes, cursor };
    }
    throw new Error('pull did not terminate');
  }

  describe('pull — change_seq cursor', () => {
    it('first sync returns the device user\'s tasks only (versioned, sequenced), never other people\'s', async () => {
      const mine = await newTask(fieldId);
      const theirs = await newTask(workshopId);
      const { changes } = await pullAll(t.field);
      const ids = changes.filter((c) => c.entity === 'task').map((c) => c.record.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
      // the seeded demo tasks are there too
      expect(changes.filter((c) => c.entity === 'task' && c.op === 'upsert' && (c.record as TaskDto).title.startsWith('Pose enseigne')).length).toBeGreaterThan(0);
      const rec = changes.find((c) => c.entity === 'task' && c.record.id === mine.id)!;
      expect(rec).toMatchObject({ op: 'upsert', record: { version: 1, status: 'TODO', assignedTo: fieldId } });
      expect(/^\d+$/.test(rec.changeSeq)).toBe(true);
    });

    it('is incremental: a follow-up pull returns only what changed since the cursor', async () => {
      const { cursor } = await pullAll(t.field);
      expect((await pull(t.field, cursor).expect(200)).body).toMatchObject({ changes: [], nextCursor: cursor, hasMore: false });

      const a = await newTask(fieldId);
      const res = (await pull(t.field, cursor).expect(200)).body;
      expect(res.changes.map((c: SyncChange) => c.record.id)).toEqual([a.id]);
      expect(BigInt(res.nextCursor)).toBeGreaterThan(BigInt(cursor));
      expect((await pull(t.field, res.nextCursor).expect(200)).body.changes).toEqual([]);
    });

    it('pages with hasMore: every change exactly once, in strictly increasing change_seq order', async () => {
      const { cursor } = await pullAll(t.field);
      const made = [await newTask(fieldId), await newTask(fieldId), await newTask(fieldId), await newTask(fieldId), await newTask(fieldId)];
      const seen: SyncChange[] = [];
      let c = cursor;
      const pages: number[] = [];
      for (;;) {
        const res = (await pull(t.field, c, 2).expect(200)).body;
        pages.push(res.changes.length);
        seen.push(...res.changes);
        c = res.nextCursor;
        if (!res.hasMore) break;
      }
      expect(pages).toEqual([2, 2, 1]);
      expect(seen.map((s) => s.record.id)).toEqual(made.map((m) => m.id));
      const seqs = seen.map((s) => BigInt(s.changeSeq));
      expect(seqs).toEqual([...seqs].sort((x, y) => (x < y ? -1 : 1)));
      expect(new Set(seqs).size).toBe(seqs.length);
    });

    it('is NOT a timestamp cursor: rows with an IDENTICAL updated_at are all delivered, none lost at the page boundary', async () => {
      const { cursor } = await pullAll(t.field);
      const [a, b, c] = [await newTask(fieldId), await newTask(fieldId), await newTask(fieldId)];
      const after = (await pullAll(t.field)).cursor;
      // one transaction → one now() → all three rows get the SAME updated_at
      await db().transaction().execute(async (trx) => {
        for (const x of [a, b, c]) await trx.updateTable('workforce.tasks').set({ notes: 'same instant' }).where('id', '=', x.id).execute();
      });
      const rows = await db().selectFrom('workforce.tasks').select(['updated_at', 'change_seq']).where('id', 'in', [a.id, b.id, c.id]).execute();
      expect(new Set(rows.map((r) => r.updated_at.getTime())).size).toBe(1); // a timestamp cursor cannot tell them apart…
      expect(new Set(rows.map((r) => r.change_seq)).size).toBe(3); // …change_seq can

      const { changes } = await pullAll(t.field, after, 1); // page size 1: a `> updated_at` cursor would now skip two of them
      expect(changes.map((x) => x.record.id).sort()).toEqual([a.id, b.id, c.id].sort());
      void cursor;
    });

    it('tells devices about deletions (tombstone) and re-pulls a task that changed on the server', async () => {
      const task = await newTask(fieldId);
      const { cursor } = await pullAll(t.field);
      await http(app).patch(`/api/v1/workforce/tasks/${task.id}`).set(bearer(t.workshop)).send({ title: 'Renamed by supervisor' }).expect(200);
      let res = (await pull(t.field, cursor).expect(200)).body;
      expect(res.changes[0]).toMatchObject({ op: 'upsert', record: { id: task.id, title: 'Renamed by supervisor', version: 2 } });

      await http(app).delete(`/api/v1/workforce/tasks/${task.id}`).set(bearer(t.workshop)).expect(204);
      res = (await pull(t.field, res.nextCursor).expect(200)).body;
      expect(res.changes).toEqual([{ entity: 'task', op: 'delete', changeSeq: expect.any(String), record: { id: task.id } }]);
    });

    it('validates its input and requires authentication + a permission', async () => {
      await pull(t.field, 'abc').expect(400);
      await pull(t.field, '-1').expect(400);
      await pull(t.field, '0', 0).expect(400);
      await pull(t.field, '0', 501).expect(400);
      await http(app).get('/api/v1/sync/pull').expect(401);
      await pull(t.sales).expect(403); // no workforce.task.read
    });
  });

  describe('push — optimistic concurrency', () => {
    it('applies a change: version and change_seq advance, and the DB holds it', async () => {
      const task = await newTask(fieldId);
      const r = await one(t.field, mut(task.id, 1, { status: 'IN_PROGRESS', hoursLogged: '2.5', notes: 'on site' }));
      expect(r).toMatchObject({ status: 'APPLIED', replayed: false, record: { id: task.id, status: 'IN_PROGRESS', hoursLogged: '2.50', notes: 'on site', version: 2 } });
      expect(BigInt(r.record!.changeSeq)).toBeGreaterThan(BigInt(task.changeSeq));
      expect(await dbTask(task.id)).toMatchObject({ status: 'IN_PROGRESS', hours_logged: '2.50', version: 2 });
    });

    it('CONFLICT when the device edited a stale version — nothing is overwritten, the server copy comes back', async () => {
      const task = await newTask(fieldId);
      await http(app).patch(`/api/v1/workforce/tasks/${task.id}`).set(bearer(t.workshop)).send({ title: 'Supervisor edit', notes: 'server note' }).expect(200); // → v2
      const r = await one(t.field, mut(task.id, 1, { notes: 'device note', status: 'DONE' }));
      expect(r).toMatchObject({ status: 'CONFLICT', code: 'VERSION_CONFLICT', replayed: false });
      expect(r.serverRecord).toMatchObject({ version: 2, title: 'Supervisor edit', notes: 'server note', status: 'TODO' });
      expect(r.record).toBeUndefined();
      expect(await dbTask(task.id)).toMatchObject({ notes: 'server note', status: 'TODO', version: 2 }); // untouched
    });

    it('two devices push against the SAME base version at once → exactly one applies, one conflicts', async () => {
      const task = await newTask(fieldId);
      const [a, b] = await Promise.all([
        push(t.field, [mut(task.id, 1, { status: 'IN_PROGRESS' })], 'phone-1'),
        push(t.field, [mut(task.id, 1, { notes: 'from the tablet', hoursLogged: '4' })], 'tablet-1'),
      ]);
      const results = [a.body.results[0], b.body.results[0]] as SyncMutationResult[];
      expect(results.map((r) => r.status).sort()).toEqual(['APPLIED', 'CONFLICT']);

      const winner = results.find((r) => r.status === 'APPLIED')!;
      const loser = results.find((r) => r.status === 'CONFLICT')!;
      expect(winner.record!.version).toBe(2);
      expect(loser.serverRecord).toMatchObject({ version: 2, id: task.id });
      // the loser's fields did NOT leak in alongside the winner's
      const row = await dbTask(task.id);
      expect(row.version).toBe(2);
      const winnerChangedStatus = winner.record!.status === 'IN_PROGRESS';
      expect(winnerChangedStatus ? row.notes : row.status).toBe(winnerChangedStatus ? null : 'TODO');
    });

    it('a REPLAYED push (same idempotency key) is a no-op that returns the stored result', async () => {
      const task = await newTask(fieldId);
      const key = `replay-${uniq()}`;
      const m = mut(task.id, 1, { status: 'IN_PROGRESS', hoursLogged: '1' }, key);

      const first = await one(t.field, m);
      expect(first).toMatchObject({ status: 'APPLIED', replayed: false, record: { version: 2 } });

      const second = await one(t.field, m); // the device never saw the response and retries
      expect(second).toMatchObject({ status: 'APPLIED', replayed: true, record: { version: 2, changeSeq: first.record!.changeSeq } });
      expect((await dbTask(task.id)).version).toBe(2); // NOT 3

      // even after the task moves on, a late retry still gets the ORIGINAL answer and changes nothing
      await http(app).patch(`/api/v1/workforce/tasks/${task.id}`).set(bearer(t.workshop)).send({ status: 'BLOCKED' }).expect(200); // → v3
      const late = await one(t.field, m);
      expect(late).toMatchObject({ status: 'APPLIED', replayed: true, record: { version: 2, status: 'IN_PROGRESS' } });
      expect(await dbTask(task.id)).toMatchObject({ version: 3, status: 'BLOCKED' });

      const stored = await db().selectFrom('workforce.sync_mutations').select(['outcome']).where('idempotency_key', '=', key).execute();
      expect(stored).toEqual([{ outcome: 'APPLIED' }]); // one row, however often it was sent
    });

    it('a replayed CONFLICT is replayed as the same conflict (the device has not resolved it yet)', async () => {
      const task = await newTask(fieldId);
      await http(app).patch(`/api/v1/workforce/tasks/${task.id}`).set(bearer(t.workshop)).send({ notes: 'x' }).expect(200);
      const m = mut(task.id, 1, { status: 'DONE' });
      const first = await one(t.field, m);
      const second = await one(t.field, m);
      expect(first.status).toBe('CONFLICT');
      expect(second).toMatchObject({ status: 'CONFLICT', replayed: true, serverRecord: { version: 2 } });
    });

    it('five identical pushes racing each other apply exactly once', async () => {
      const task = await newTask(fieldId);
      const m = mut(task.id, 1, { hoursLogged: '3' }, `race-${uniq()}`);
      const responses = await Promise.all(Array.from({ length: 5 }, () => push(t.field, [m])));
      const results = responses.map((r) => r.body.results[0] as SyncMutationResult);
      expect(results.every((r) => r.status === 'APPLIED')).toBe(true);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(results.filter((r) => r.replayed)).toHaveLength(4);
      expect((await dbTask(task.id)).version).toBe(2);
    });

    it('applies a batch in order: rebased mutations succeed, a mutation still on the old base conflicts', async () => {
      const task = await newTask(fieldId);
      const ok = (await push(t.field, [mut(task.id, 1, { status: 'IN_PROGRESS' }), mut(task.id, 2, { hoursLogged: '1.5' }), mut(task.id, 3, { status: 'DONE' })]).expect(200)).body.results;
      expect(ok.map((r: SyncMutationResult) => [r.status, r.record?.version])).toEqual([['APPLIED', 2], ['APPLIED', 3], ['APPLIED', 4]]);

      const task2 = await newTask(fieldId);
      const bad = (await push(t.field, [mut(task2.id, 1, { status: 'IN_PROGRESS' }), mut(task2.id, 1, { hoursLogged: '1' })]).expect(200)).body.results;
      expect(bad.map((r: SyncMutationResult) => r.status)).toEqual(['APPLIED', 'CONFLICT']); // the 2nd was not rebased
    });

    it('one bad mutation does not sink the others in the batch', async () => {
      const a = await newTask(fieldId);
      const b = await newTask(fieldId);
      const res = (await push(t.field, [mut(a.id, 99, { status: 'DONE' }), mut(b.id, 1, { status: 'DONE' })]).expect(200)).body.results;
      expect(res.map((r: SyncMutationResult) => r.status)).toEqual(['CONFLICT', 'APPLIED']);
    });

    it('an idempotency key cannot be reused for a different task', async () => {
      const a = await newTask(fieldId);
      const b = await newTask(fieldId);
      const key = `reuse-${uniq()}`;
      await one(t.field, mut(a.id, 1, { status: 'IN_PROGRESS' }, key));
      const r = await one(t.field, mut(b.id, 1, { status: 'IN_PROGRESS' }, key));
      expect(r).toMatchObject({ status: 'REJECTED', code: 'IDEMPOTENCY_KEY_REUSED' });
      expect((await dbTask(b.id)).version).toBe(1);
    });

    it('idempotency keys are per user: two users may use the same key string', async () => {
      const mineTask = await newTask(fieldId);
      const workshopTask = await newTask(workshopId);
      const key = `shared-${uniq()}`;
      expect((await one(t.field, mut(mineTask.id, 1, { status: 'IN_PROGRESS' }, key))).status).toBe('APPLIED');
      expect((await one(t.workshop, mut(workshopTask.id, 1, { status: 'IN_PROGRESS' }, key))).status).toBe('APPLIED');
    });

    it('is authenticated and permission-guarded; a worker cannot touch a task assigned to someone else', async () => {
      const others = await newTask(workshopId);
      await http(app).post('/api/v1/sync/push').send({ deviceId: 'x', mutations: [mut(others.id, 1, { status: 'DONE' })] }).expect(401);
      await push(t.sales, [mut(others.id, 1, { status: 'DONE' })]).expect(403);

      const r = await one(t.field, mut(others.id, 1, { status: 'DONE' }));
      expect(r).toMatchObject({ status: 'REJECTED', code: 'NOT_FOUND' }); // does not even reveal it exists
      expect((await dbTask(others.id)).status).toBe('TODO');

      const asSupervisor = await one(t.workshop, mut(others.id, 1, { status: 'IN_PROGRESS' })); // read_all → may update anyone's
      expect(asSupervisor.status).toBe('APPLIED');
    });

    it('rejects an update to a deleted task and an unknown task', async () => {
      const task = await newTask(fieldId);
      await http(app).delete(`/api/v1/workforce/tasks/${task.id}`).set(bearer(t.workshop)).expect(204);
      expect((await one(t.field, mut(task.id, 1, { status: 'DONE' }))).code).toBe('NOT_FOUND');
      expect((await one(t.field, mut('11111111-1111-1111-1111-111111111111', 1, { status: 'DONE' }))).code).toBe('NOT_FOUND');
    });

    it('validates the payload at the boundary', async () => {
      const task = await newTask(fieldId);
      const bad = (m: unknown) => push(t.field, [m]).expect(400);
      await bad(mut(task.id, 1, {}));
      await bad(mut(task.id, 1, { status: 'FLYING' }));
      await bad(mut(task.id, 0, { status: 'DONE' }));
      await bad(mut(task.id, 1.5, { status: 'DONE' }));
      await bad(mut(task.id, 1, { hoursLogged: '2.555' }));
      await bad(mut(task.id, 1, { hoursLogged: 2.5 }));
      await bad(mut(task.id, 1, { status: 'DONE' }, 'short'));
      await bad({ ...mut(task.id, 1, { status: 'DONE' }), entity: 'customer' });
      await push(t.field, []).expect(400);
      await push(t.field, Array.from({ length: 101 }, () => mut(task.id, 1, { status: 'DONE' }))).expect(400);
      await http(app).post('/api/v1/sync/push').set(bearer(t.field)).send({ mutations: [mut(task.id, 1, { status: 'DONE' })] }).expect(400); // no deviceId
    });

    it('marking a linked task DONE completes its work order — once, and never past a closed production order', async () => {
      const customer = (await http(app).post('/api/v1/customers').set(bearer(t.sales)).send({ name: `WO Client ${uniq()}` }).expect(201)).body;
      const order = (await http(app).post('/api/v1/orders').set(bearer(t.admin)).send({ customerId: customer.id, items: [{ description: 'x', quantity: '1', unitPrice: '100', overrideReason: 'test fixture' }] }).expect(201)).body;
      const confirmed = (await http(app).post(`/api/v1/orders/${order.id}/confirm`).set(bearer(t.sales)).expect(200)).body;
      const po = (await http(app).get(`/api/v1/production/orders/${confirmed.productionOrder.id}`).set(bearer(t.admin)).expect(200)).body;
      const wo = po.workOrders[0];

      const task = await newTask(fieldId, { workOrderId: wo.id });
      await one(t.field, mut(task.id, 1, { status: 'DONE' }));
      const row = await db().selectFrom('erp.work_orders').select(['status', 'completed_at']).where('id', '=', wo.id).executeTakeFirstOrThrow();
      expect(row.status).toBe('COMPLETED');
      expect(row.completed_at).not.toBeNull();
    });
  });

  describe('change_seq under concurrency', () => {
    it('8 simultaneous pushes to 8 tasks: a device paging one change at a time sees all 8 exactly once', async () => {
      const tasks = await Promise.all(Array.from({ length: 8 }, () => newTask(fieldId)));
      const { cursor } = await pullAll(t.field);
      const results = await Promise.all(tasks.map((task) => one(t.field, mut(task.id, 1, { status: 'IN_PROGRESS' }))));
      expect(results.every((r) => r.status === 'APPLIED')).toBe(true);

      const { changes } = await pullAll(t.field, cursor, 1);
      const ids = changes.map((c) => c.record.id);
      expect([...ids].sort()).toEqual(tasks.map((x) => x.id).sort());
      expect(new Set(ids).size).toBe(8);
      const seqs = changes.map((c) => BigInt(c.changeSeq));
      expect(seqs).toEqual([...seqs].sort((a, b) => (a < b ? -1 : 1)));
    });
  });

  describe('task management API', () => {
    it('supervisors create/assign/update; workers only see their own; version and seq advance on every server-side change', async () => {
      await http(app).post('/api/v1/workforce/tasks').set(bearer(t.field)).send({ title: 'Self-assigned' }).expect(403);
      const task = await newTask(fieldId, { description: 'Mesurer la façade', dueDate: '2026-12-01' });
      expect(task).toMatchObject({ version: 1, status: 'TODO', assignedTo: fieldId, dueDate: '2026-12-01' });

      const mine = (await http(app).get('/api/v1/workforce/tasks').set(bearer(t.field)).expect(200)).body;
      expect(mine.items.every((x: TaskDto) => x.assignedTo === fieldId)).toBe(true);
      const all = (await http(app).get('/api/v1/workforce/tasks').query({ assignedTo: workshopId }).set(bearer(t.workshop)).expect(200)).body;
      expect(all.items.every((x: TaskDto) => x.assignedTo === workshopId)).toBe(true);

      const updated = (await http(app).patch(`/api/v1/workforce/tasks/${task.id}`).set(bearer(t.workshop)).send({ status: 'BLOCKED' }).expect(200)).body;
      expect(updated.version).toBe(2);
      expect(BigInt(updated.changeSeq)).toBeGreaterThan(BigInt(task.changeSeq));

      await http(app).get(`/api/v1/workforce/tasks/${task.id}`).set(bearer(t.field)).expect(200);
      const other = await newTask(workshopId);
      await http(app).get(`/api/v1/workforce/tasks/${other.id}`).set(bearer(t.field)).expect(404);
      await http(app).post('/api/v1/workforce/tasks').set(bearer(t.workshop)).send({ title: 'Bad assignee', assignedTo: '11111111-1111-1111-1111-111111111111' }).expect(422);
    });
  });

  describe('proof photos (local storage)', () => {
    const upload = (token: string, fields: Record<string, string>, file: Buffer | null = PNG, filename = 'proof.png', contentType = 'image/png') => {
      let req = http(app).post('/api/v1/sync/proofs').set(bearer(token));
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      if (file) req = req.attach('photo', file, { filename, contentType });
      return req;
    };
    const newProofId = () => crypto.randomUUID();

    it('stores the photo on the local filesystem with its GPS, lists it in pull, and serves it back to authorised users only', async () => {
      const task = await newTask(fieldId);
      const proofId = newProofId();
      const { cursor } = await pullAll(t.field);

      const res = await upload(t.field, { proofId, taskId: task.id, latitude: '36.752887', longitude: '3.042048', capturedAt: '2026-09-19T09:30:00.000Z' }).expect(201);
      expect(res.body).toMatchObject({ id: proofId, taskId: task.id, mimeType: 'image/png', sizeBytes: PNG.length, latitude: '36.752887', longitude: '3.042048' });
      expect(res.body.url).toBe(`/workforce/proofs/${proofId}/file`); // relative to the API base

      // really on disk, under STORAGE_DIR, byte for byte
      const row = await db().selectFrom('workforce.task_proofs').select(['storage_key', 'uploaded_by']).where('id', '=', proofId).executeTakeFirstOrThrow();
      expect(row.uploaded_by).toBe(fieldId);
      expect(row.storage_key).toMatch(new RegExp(`^proofs/\\d{4}/\\d{2}/${proofId}\\.png$`));
      expect((await fs.readFile(path.join(process.env.STORAGE_DIR!, row.storage_key))).equals(PNG)).toBe(true);

      // pull delivers the proof as a change
      const pulled = (await pull(t.field, cursor).expect(200)).body.changes.find((c: SyncChange) => c.entity === 'proof');
      expect(pulled).toMatchObject({ op: 'upsert', record: { id: proofId, taskId: task.id } });

      // download: owner and supervisor yes; a different worker no; anonymous no
      const fileUrl = `/api/v1${res.body.url}`;
      const dl = await http(app).get(fileUrl).set(bearer(t.field)).expect(200);
      expect(dl.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
      await http(app).get(fileUrl).set(bearer(t.workshop)).expect(200);
      await http(app).get(fileUrl).expect(401);
      const other = await login(app, USERS.qa);
      await http(app).get(fileUrl).set(bearer(other.accessToken)).expect(403); // QA has no workforce.task.read at all
    });

    it('re-uploading the same proof is idempotent (200, same record, one row, one file); the id cannot be reused elsewhere', async () => {
      const task = await newTask(fieldId);
      const other = await newTask(fieldId);
      const proofId = newProofId();
      const first = await upload(t.field, { proofId, taskId: task.id }).expect(201);
      const again = await upload(t.field, { proofId, taskId: task.id }).expect(200);
      expect(again.body).toEqual(first.body);
      expect((await db().selectFrom('workforce.task_proofs').select('id').where('id', '=', proofId).execute())).toHaveLength(1);

      await upload(t.field, { proofId, taskId: other.id }).expect(409);

      // five racing uploads of one proof → one row
      const racing = newProofId();
      const rs = await Promise.all(Array.from({ length: 5 }, () => upload(t.field, { proofId: racing, taskId: task.id })));
      expect(rs.every((r) => r.status === 201 || r.status === 200)).toBe(true);
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect((await db().selectFrom('workforce.task_proofs').select('id').where('id', '=', racing).execute())).toHaveLength(1);
    });

    it('accepts JPEG and WebP too', async () => {
      const task = await newTask(fieldId);
      const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(24)]);
      expect((await upload(t.field, { proofId: newProofId(), taskId: task.id }, jpg, 'a.jpg', 'image/jpeg').expect(201)).body.mimeType).toBe('image/jpeg');
      expect((await upload(t.field, { proofId: newProofId(), taskId: task.id }, webp, 'a.webp', 'image/webp').expect(201)).body.mimeType).toBe('image/webp');
    });

    it('trusts the FILE CONTENT, not the name or claimed type: scripts, SVG and text are refused (415)', async () => {
      const task = await newTask(fieldId);
      const proofId = newProofId();
      await upload(t.field, { proofId, taskId: task.id }, Buffer.from('<?php system($_GET["c"]); ?>'), 'shell.jpg', 'image/jpeg').expect(415);
      await upload(t.field, { proofId, taskId: task.id }, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png', 'image/png').expect(415);
      expect((await db().selectFrom('workforce.task_proofs').select('id').where('id', '=', proofId).execute())).toHaveLength(0);
    });

    it('rejects a missing file (400), bad coordinates (400), an unknown/foreign task (404) and files over the size limit (413)', async () => {
      const task = await newTask(fieldId);
      const foreign = await newTask(workshopId);
      await upload(t.field, { proofId: newProofId(), taskId: task.id }, null).expect(400);
      await upload(t.field, { proofId: newProofId(), taskId: task.id, latitude: '95', longitude: '3' }).expect(400);
      await upload(t.field, { proofId: newProofId(), taskId: task.id, latitude: '36.7' }).expect(400); // lat without lon
      await upload(t.field, { proofId: 'not-a-uuid', taskId: task.id }).expect(400);
      await upload(t.field, { proofId: newProofId(), taskId: foreign.id }).expect(404);
      await upload(t.field, { proofId: newProofId(), taskId: '11111111-1111-1111-1111-111111111111' }).expect(404);

      // the e2e environment caps uploads at 64 KiB (UPLOAD_MAX_BYTES, see global-setup)
      const limit = Number(process.env.UPLOAD_MAX_BYTES);
      const overId = newProofId();
      await upload(t.field, { proofId: overId, taskId: task.id }, Buffer.concat([PNG, Buffer.alloc(limit + 1024)])).expect(413);
      expect((await db().selectFrom('workforce.task_proofs').select('id').where('id', '=', overId).execute())).toHaveLength(0); // nothing stored

      // …and a file just under the limit is fine
      await upload(t.field, { proofId: newProofId(), taskId: task.id }, Buffer.concat([PNG, Buffer.alloc(limit - PNG.length - 2048)])).expect(201);
    });

    it('needs authentication and workforce.proof.create', async () => {
      const task = await newTask(fieldId);
      await http(app).post('/api/v1/sync/proofs').field('proofId', newProofId()).field('taskId', task.id).attach('photo', PNG, 'p.png').expect(401);
      await upload(t.sales, { proofId: newProofId(), taskId: task.id }).expect(403);
    });
  });

  it('sanity: the sync tables are covered by the audit trail', async () => {
    const r = await sql<{ n: string }>`select count(*)::text as n from audit.trail where table_schema = 'workforce' and table_name = 'tasks'`.execute(db());
    expect(Number(r.rows[0]!.n)).toBeGreaterThan(10);
  });
});
