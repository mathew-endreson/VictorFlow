import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictBlockedError, conflictCount, dismissRejected, loadTaskViews, pendingCount, queueTaskEdit, rejectedCount, resolveConflict, syncOnce } from './engine';
import { FakeServer, makeTask, MemoryStore, NetworkError, PermanentError } from './testing';
import type { LocalProof } from './types';

let store: MemoryStore;
let server: FakeServer;
let n = 0;
const key = () => `key-${String(++n).padStart(4, '0')}-xxxxxxxx`; // deterministic, ≥ 8 chars
const opts = { deviceId: 'test-device', makeKey: key };
const sync = () => syncOnce(store, server, opts);
const view = async (id: string) => (await loadTaskViews(store)).find((t) => t.id === id)!;
const edit = (id: string, changes: Parameters<typeof queueTaskEdit>[2]) => queueTaskEdit(store, id, changes, undefined, key);

beforeEach(() => {
  store = new MemoryStore();
  server = new FakeServer();
  n = 0;
  server.put(makeTask({ id: 't1', title: 'Pose enseigne', dueDate: '2026-10-01' }));
  server.put(makeTask({ id: 't2', title: 'Relevé de mesures', dueDate: '2026-10-02' }));
});

describe('first sync', () => {
  it('pulls the server tasks into local storage and records the cursor', async () => {
    const report = await sync();
    expect(report.pulled).toBe(2);
    expect((await store.listTasks()).map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(store.cursor).toBe('2');
  });
});

describe('editing offline', () => {
  beforeEach(async () => {
    await sync();
    server.online = false;
  });

  it('shows the edit at once (overlay on server truth) and queues it — without touching the network', async () => {
    await edit('t1', { status: 'IN_PROGRESS', hoursLogged: '2.5', notes: 'on site' });
    const v = await view('t1');
    expect(v).toMatchObject({ status: 'IN_PROGRESS', hoursLogged: '2.5', notes: 'on site', pending: true, version: 1 });
    expect((await store.getTask('t1'))!.status).toBe('TODO'); // stored row is still server truth
    expect(pendingCount(await store.listOutbox())).toBe(1);
    expect(server.pushCalls).toBe(0);
  });

  it('coalesces several offline edits to one task into ONE queued mutation (latest value wins per field)', async () => {
    await edit('t1', { status: 'IN_PROGRESS' });
    await edit('t1', { hoursLogged: '1' });
    await edit('t1', { hoursLogged: '3.5', notes: 'done soon' });
    const outbox = await store.listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.changes).toEqual({ status: 'IN_PROGRESS', hoursLogged: '3.5', notes: 'done soon' });
    expect(outbox[0]!.baseVersion).toBe(1);
  });

  it('a failed sync while offline throws NetworkError and loses nothing', async () => {
    await edit('t1', { status: 'DONE' });
    await expect(sync()).rejects.toBeInstanceOf(NetworkError);
    expect(pendingCount(await store.listOutbox())).toBe(1);
    expect((await view('t1')).status).toBe('DONE');
  });

  it('OFFLINE → edit → ONLINE → sync applies the change on the server exactly once', async () => {
    await edit('t1', { status: 'IN_PROGRESS', hoursLogged: '2.5' });
    server.online = true;
    const report = await sync();
    expect(report).toMatchObject({ pushed: 1, applied: 1, conflicts: 0 });

    expect(server.tasks.get('t1')).toMatchObject({ status: 'IN_PROGRESS', hoursLogged: '2.5', version: 2 });
    expect(await store.listOutbox()).toEqual([]);
    expect(await store.getTask('t1')).toMatchObject({ status: 'IN_PROGRESS', version: 2 }); // local truth advanced
    expect(await view('t1')).toMatchObject({ pending: false, conflict: null });
    expect(await syncOnce(store, server, opts)).toMatchObject({ pushed: 0, pulled: 0 }); // nothing left to do
  });
});

describe('idempotency & lost responses', () => {
  beforeEach(async () => {
    await sync();
  });

  it('when the server applied the push but the response was lost, the retry replays — it does not apply twice', async () => {
    await edit('t1', { status: 'IN_PROGRESS' });
    const itemKey = (await store.listOutbox())[0]!.id;

    server.dropNextPushResponse = true;
    await expect(sync()).rejects.toBeInstanceOf(NetworkError); // server applied it; the device never heard
    expect(server.tasks.get('t1')!.version).toBe(2);
    expect(pendingCount(await store.listOutbox())).toBe(1); // device still thinks it is unsent

    const report = await sync(); // retry with the SAME key
    expect(report.applied).toBe(1);
    expect(server.tasks.get('t1')!.version).toBe(2); // still 2, not 3
    expect(server.applyCount.get(itemKey)).toBe(1);
    expect(await store.listOutbox()).toEqual([]);
    expect(await view('t1')).toMatchObject({ status: 'IN_PROGRESS', version: 2, pending: false });
  });

  it('an edit made WHILE a sync is in flight is not lost', async () => {
    await edit('t1', { status: 'IN_PROGRESS' });
    // after the server applied the first edit, but before the device processes the response, the user edits again
    server.onPushInFlight = async () => { await edit('t1', { hoursLogged: '4' }); };
    await sync();

    // the first edit landed; the second is still queued, re-based on the version the first created
    expect(server.tasks.get('t1')).toMatchObject({ status: 'IN_PROGRESS', version: 2, hoursLogged: '0.00' });
    const outbox = await store.listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ baseVersion: 2, status: 'PENDING' });
    expect((await view('t1')).hoursLogged).toBe('4');

    await sync(); // the leftover goes out on the next sync and applies cleanly
    expect(server.tasks.get('t1')).toMatchObject({ hoursLogged: '4', version: 3 });
    expect(await store.listOutbox()).toEqual([]);
  });

  it('an edit made WHILE a sync is in flight is not lost when that push turns out to be a CONFLICT', async () => {
    await sync();
    await edit('t1', { status: 'DONE' });
    server.put({ ...server.tasks.get('t1')!, notes: 'changed on the desktop' }); // the server moves on: the push will conflict
    server.onPushInFlight = async () => { await edit('t1', { hoursLogged: '4' }); };
    await sync();

    const [item] = await store.listOutbox();
    expect(item).toMatchObject({ status: 'CONFLICT' });
    expect(item!.changes).toEqual({ status: 'DONE', hoursLogged: '4' }); // both edits survive, waiting for the user's decision
    expect(server.tasks.get('t1')).toMatchObject({ status: 'TODO', notes: 'changed on the desktop' }); // and nothing was overwritten
  });

  it('an edit made WHILE a sync is in flight is not lost when the server REJECTS the push either', async () => {
    await sync();
    await edit('t1', { status: 'DONE' });
    server.rejectNextEdit = { code: 'FORBIDDEN', error: 'Not allowed' };
    server.onPushInFlight = async () => { await edit('t1', { hoursLogged: '4' }); };
    await sync();

    const [item] = await store.listOutbox();
    expect(item).toMatchObject({ status: 'FAILED', error: 'Not allowed' });
    expect(item!.changes).toEqual({ status: 'DONE', hoursLogged: '4' });
  });

  it('several tasks in one push are independent: one can conflict while the other applies', async () => {
    await edit('t1', { status: 'DONE' });
    await edit('t2', { status: 'DONE' });
    server.put({ ...server.tasks.get('t1')!, notes: 'changed on the desktop' }); // t1 → v2 behind the device's back
    const report = await sync();
    expect(report).toMatchObject({ applied: 1, conflicts: 1 });
    expect(server.tasks.get('t2')!.status).toBe('DONE');
    expect(server.tasks.get('t1')!.status).toBe('TODO');
    expect(conflictCount(await store.listOutbox())).toBe(1);
  });
});

describe('conflicts (optimistic concurrency)', () => {
  beforeEach(async () => {
    await sync();
    server.online = false;
    await edit('t1', { status: 'DONE', notes: 'my note' });
    server.online = true;
    server.put({ ...server.tasks.get('t1')!, notes: 'supervisor note', status: 'BLOCKED' }); // another client wins the race → v2
  });

  it('detects that the server moved on: nothing is overwritten, the server copy is stored, my edit is kept', async () => {
    const report = await sync();
    expect(report.conflicts).toBe(1);
    expect(server.tasks.get('t1')).toMatchObject({ status: 'BLOCKED', notes: 'supervisor note', version: 2 }); // untouched

    const v = await view('t1');
    expect(v.conflict).not.toBeNull();
    expect(v.conflict!.conflict).toMatchObject({ version: 2, notes: 'supervisor note' });
    expect(v).toMatchObject({ status: 'DONE', notes: 'my note', version: 2 }); // shows MY edit on the SERVER's version
    expect(conflictCount(await store.listOutbox())).toBe(1);
  });

  it('blocks further edits to that task until the conflict is resolved', async () => {
    await sync();
    await expect(edit('t1', { hoursLogged: '9' })).rejects.toBeInstanceOf(ConflictBlockedError);
    await edit('t2', { status: 'IN_PROGRESS' }); // other tasks are unaffected
  });

  it("'Use server version' drops my edit and shows the server's values", async () => {
    await sync();
    const item = (await store.listOutbox())[0]!;
    await resolveConflict(store, item.id, 'server', key);
    expect(await store.listOutbox()).toEqual([]);
    expect(await view('t1')).toMatchObject({ status: 'BLOCKED', notes: 'supervisor note', pending: false, conflict: null });
    expect((await sync()).pushed).toBe(0);
  });

  it("'Keep mine' re-applies my edit on top of the server's version under a NEW key, and it goes through", async () => {
    await sync();
    const conflicted = (await store.listOutbox())[0]!;
    await resolveConflict(store, conflicted.id, 'mine', key);

    const [retry] = await store.listOutbox();
    expect(retry).toMatchObject({ status: 'PENDING', baseVersion: 2, conflict: null });
    expect(retry!.id).not.toBe(conflicted.id); // the old key's stored answer was the conflict

    expect((await sync()).applied).toBe(1);
    expect(server.tasks.get('t1')).toMatchObject({ status: 'DONE', notes: 'my note', version: 3 });
    expect(await store.listOutbox()).toEqual([]);
  });
});

describe('pull', () => {
  it('is incremental: only changes past the cursor come down, and the cursor moves only from pull responses', async () => {
    await sync();
    expect((await sync()).pulled).toBe(0);
    server.put(makeTask({ id: 't3', title: 'New job' }));
    server.put({ ...server.tasks.get('t1')!, title: 'Renamed' });
    const report = await sync();
    expect(report.pulled).toBe(2);
    expect((await store.getTask('t1'))!.title).toBe('Renamed');
    expect(await store.getTask('t3')).not.toBeNull();
    expect(store.cursor).toBe(String(server.tasks.get('t1')!.changeSeq));
  });

  it('a push result never advances the cursor (or changes by others with lower sequence numbers would be skipped)', async () => {
    await sync();
    const before = store.cursor;
    server.put(makeTask({ id: 't9', title: 'Made by someone else meanwhile' })); // seq 3
    await edit('t1', { status: 'DONE' });
    await sync(); // push applies t1 (seq 4) — but the cursor must still have picked up seq 3
    expect(await store.getTask('t9')).not.toBeNull();
    expect(Number(store.cursor)).toBeGreaterThan(Number(before));
  });

  it('pages through large change sets (hasMore) without dropping or repeating anything', async () => {
    for (let i = 0; i < 7; i++) server.put(makeTask({ id: `bulk-${i}` }));
    const report = await syncOnce(store, server, { ...opts, pullPageSize: 3 });
    expect(report.pulled).toBe(9); // 2 + 7
    expect((await store.listTasks()).length).toBe(9);
  });

  const localProof = (taskId: string): LocalProof => ({ id: `p-${taskId}`, taskId, fileUri: 'file:///x.jpg', mimeType: 'image/jpeg', latitude: null, longitude: null, capturedAt: '', status: 'PENDING', error: null, remote: null });

  it('applies a deletion tombstone from pull: the task and its photos disappear from the device', async () => {
    await sync();
    await store.putProof(localProof('t1'));
    server.remove('t1'); // deleted on the desktop; the device has no queued edit for it
    const report = await sync();
    expect(report.pulled).toBe(1);
    expect(await store.getTask('t1')).toBeNull();
    expect(await store.listProofs('t1')).toEqual([]);
    expect(await store.getTask('t2')).not.toBeNull(); // others untouched
  });

  it('a queued edit to a task that was deleted meanwhile is rejected by the server and cleaned up (nothing to edit any more)', async () => {
    await sync();
    await edit('t1', { status: 'DONE' });
    await store.putProof(localProof('t1'));
    server.remove('t1');
    const report = await sync(); // push: REJECTED (NOT_FOUND) → the engine drops the task, its edit and its photos
    expect(report.rejected).toBe(1);
    expect(await store.getTask('t1')).toBeNull();
    expect((await store.listOutbox()).filter((o) => o.taskId === 't1')).toEqual([]);
    expect(await store.listProofs('t1')).toEqual([]);
  });

  it("a full sync prunes tasks the server no longer lists for this user (reassigned away)", async () => {
    await sync();
    await store.upsertTask(makeTask({ id: 'ghost', title: 'Reassigned long ago' }));
    store.cursor = '0'; // e.g. after re-login: full resync
    await sync();
    expect(await store.getTask('ghost')).toBeNull();
    expect(await store.getTask('t1')).not.toBeNull();
  });

  it('a server-side edit to a task with a queued edit surfaces as a conflict on the next push (never a silent overwrite)', async () => {
    await sync();
    await edit('t1', { status: 'DONE' });
    server.put({ ...server.tasks.get('t1')!, title: 'Renamed on desktop' });
    const report = await sync();
    expect(report.conflicts).toBe(1);
    expect((await store.getTask('t1'))!.title).toBe('Renamed on desktop');
  });
});

describe('proof photos', () => {
  const proof = (id: string, over: Partial<LocalProof> = {}): LocalProof => ({ id, taskId: 't1', fileUri: `file:///${id}.jpg`, mimeType: 'image/jpeg', latitude: 36.752887, longitude: 3.042048, capturedAt: '2026-09-19T09:30:00Z', status: 'PENDING', error: null, remote: null, ...over });

  beforeEach(async () => {
    await sync();
  });

  it('uploads queued photos on sync and marks them uploaded', async () => {
    await store.putProof(proof('p1'));
    expect((await sync()).uploaded).toBe(1);
    expect(server.proofs.get('p1')).toMatchObject({ taskId: 't1', latitude: '36.752887', longitude: '3.042048' });
    expect((await store.listProofs('t1'))[0]).toMatchObject({ status: 'UPLOADED', remote: { id: 'p1' } });
  });

  it('keeps a photo queued when offline; the next sync uploads it', async () => {
    await store.putProof(proof('p1'));
    server.online = false;
    await expect(sync()).rejects.toBeInstanceOf(NetworkError);
    expect((await store.listProofs())[0]!.status).toBe('PENDING');
    server.online = true;
    expect((await sync()).uploaded).toBe(1);
  });

  it('marks a photo the server refuses for good as FAILED, and does not retry it forever', async () => {
    await store.putProof(proof('bad'));
    server.uploadError = new PermanentError('Only JPEG, PNG or WebP images are accepted');
    await sync();
    expect((await store.listProofs())[0]).toMatchObject({ status: 'FAILED', error: expect.stringContaining('JPEG') });
    server.uploadError = null;
    expect((await sync()).uploaded).toBe(0);
  });
});

describe('edits the server refused', () => {
  beforeEach(async () => {
    await sync();
    await edit('t1', { status: 'DONE', hoursLogged: '2' });
    server.rejectNextEdit = { code: 'FORBIDDEN', error: 'You cannot close this task' };
    await sync();
  });

  it('are shown to the user instead of silently vanishing: the task reverts to server truth and says why', async () => {
    const v = await view('t1');
    expect(v).toMatchObject({ status: 'TODO', pending: false, conflict: null }); // not applied anywhere
    expect(v.rejected).toMatchObject({ status: 'FAILED', error: 'You cannot close this task', changes: { status: 'DONE', hoursLogged: '2' } });
    expect(rejectedCount(await store.listOutbox())).toBe(1);
  });

  it('do not block a new edit, and stay visible until the user dismisses them', async () => {
    await edit('t1', { notes: 'trying again' });
    expect(await sync()).toMatchObject({ applied: 1 });
    expect((await view('t1')).rejected).not.toBeNull();

    await dismissRejected(store, (await view('t1')).rejected!.id);
    expect((await view('t1')).rejected).toBeNull();
    expect(rejectedCount(await store.listOutbox())).toBe(0);
  });

  it('dismissRejected leaves queued edits and conflicts alone', async () => {
    await edit('t2', { status: 'DONE' });
    const pending = (await store.listOutbox()).find((o) => o.status === 'PENDING')!;
    await dismissRejected(store, pending.id);
    expect((await store.listOutbox()).some((o) => o.id === pending.id)).toBe(true);
  });
});
