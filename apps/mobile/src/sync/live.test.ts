/**
 * OPT-IN integration test: the REAL sync engine against the REAL VictorFlow API (and its Postgres).
 *
 *   pnpm dev:up                                   # or: API + Postgres running with the seeded data
 *   VF_LIVE_API=http://localhost:3000/api/v1 pnpm --filter @victorflow/mobile test
 *
 * Skipped unless VF_LIVE_API is set. It proves the parts a fake server cannot: that the engine's request/response
 * shapes, idempotency keys, version checks and pull cursor really work against the actual server.
 */
import type { LoginResponse, ProofDto, SyncPullResponse, SyncPushResponse, TaskDto } from '@victorflow/types';
import { describe, expect, it } from 'vitest';
import { conflictCount, loadTaskViews, pendingCount, queueTaskEdit, resolveConflict, syncOnce } from './engine';
import { MemoryStore } from './testing';
import { NetworkError, PermanentError, type LocalProof, type PushMutation, type SyncApi } from './types';

const API = process.env.VF_LIVE_API;
const PASSWORD = process.env.VF_LIVE_PASSWORD ?? 'Admin123!';
// a real 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function login(email: string): Promise<LoginResponse> {
  return json(await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }));
}

/** The device-side API, over plain fetch — the same wire format ApiClient (expo) speaks. */
class HttpSyncApi implements SyncApi {
  dropNextPushResponse = false;
  constructor(private readonly token: string) {}
  private h = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${this.token}`, ...extra });

  async push(deviceId: string, mutations: PushMutation[]) {
    const res = await fetch(`${API}/sync/push`, { method: 'POST', headers: this.h({ 'content-type': 'application/json' }), body: JSON.stringify({ deviceId, mutations }) });
    const body = await json<SyncPushResponse>(res);
    if (this.dropNextPushResponse) {
      this.dropNextPushResponse = false;
      throw new NetworkError('response lost'); // the server DID apply it
    }
    return body;
  }
  async pull(cursor: string, limit: number) {
    return json<SyncPullResponse>(await fetch(`${API}/sync/pull?cursor=${cursor}&limit=${limit}`, { headers: this.h() }));
  }
  async uploadProof(p: LocalProof) {
    const form = new FormData();
    form.append('proofId', p.id);
    form.append('taskId', p.taskId);
    if (p.latitude !== null && p.longitude !== null) {
      form.append('latitude', String(p.latitude));
      form.append('longitude', String(p.longitude));
    }
    form.append('photo', new Blob([PNG], { type: 'image/png' }), `${p.id}.png`);
    const res = await fetch(`${API}/sync/proofs`, { method: 'POST', headers: this.h(), body: form });
    if (res.status >= 400 && res.status < 500) throw new PermanentError(`${res.status}`);
    return json<ProofDto>(res);
  }
}

describe.skipIf(!API)('sync engine ⇄ REAL API', () => {
  it('offline edit → online sync, lost-response retry, real conflict, and proof upload', async () => {
    const field = await login('field@victorflow.local');
    const shop = await login('workshop@victorflow.local');
    const asShop = (path: string, init: RequestInit = {}) => fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${shop.accessToken}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const serverTask = async (id: string) => json<TaskDto>(await asShop(`/workforce/tasks/${id}`));

    const created = await json<TaskDto>(await asShop('/workforce/tasks', { method: 'POST', body: JSON.stringify({ title: `Live sync ${Date.now()}`, assignedTo: field.user.id }) }));

    const store = new MemoryStore();
    const api = new HttpSyncApi(field.accessToken);
    const opts = { deviceId: 'live-test-device', pullPageSize: 100 };

    // first sync: the device learns its tasks (paged) and the cursor moves
    const first = await syncOnce(store, api, opts);
    expect(first.pulled).toBeGreaterThan(0);
    expect(await store.getTask(created.id)).toMatchObject({ id: created.id, version: 1, status: 'TODO' });
    expect(BigInt(await store.getCursor())).toBeGreaterThan(0n);

    // ── offline: two edits, coalesced; the server has heard nothing ──
    await queueTaskEdit(store, created.id, { status: 'IN_PROGRESS' });
    await queueTaskEdit(store, created.id, { hoursLogged: '2.5', notes: 'measured the façade' });
    expect((await store.listOutbox())).toHaveLength(1);
    expect(await serverTask(created.id)).toMatchObject({ status: 'TODO', version: 1 });
    expect(await loadTaskViews(store)).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, status: 'IN_PROGRESS', pending: true })]));

    // ── back online: ONE mutation goes out and the real server applies it ──
    const online = await syncOnce(store, api, opts);
    expect(online).toMatchObject({ applied: 1, conflicts: 0 });
    expect(await serverTask(created.id)).toMatchObject({ status: 'IN_PROGRESS', hoursLogged: '2.50', notes: 'measured the façade', version: 2 });
    expect(pendingCount(await store.listOutbox())).toBe(0);
    expect(await store.getTask(created.id)).toMatchObject({ version: 2 });

    // ── lost response: the server applies it, the device never hears → retry must not apply twice ──
    await queueTaskEdit(store, created.id, { hoursLogged: '4' });
    api.dropNextPushResponse = true;
    await expect(syncOnce(store, api, opts)).rejects.toBeInstanceOf(NetworkError);
    expect(await serverTask(created.id)).toMatchObject({ hoursLogged: '4.00', version: 3 }); // applied…
    const retry = await syncOnce(store, api, opts); //                                         …and the retry replays it
    expect(retry.applied).toBe(1);
    expect(await serverTask(created.id)).toMatchObject({ hoursLogged: '4.00', version: 3 }); // still 3, not 4
    expect(pendingCount(await store.listOutbox())).toBe(0);

    // ── a REAL conflict: a supervisor edits the task while the device holds an unsynced edit ──
    await queueTaskEdit(store, created.id, { status: 'DONE', notes: 'all finished' });
    await json(await asShop(`/workforce/tasks/${created.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'BLOCKED', notes: 'waiting for the crane' }) }));
    const conflicted = await syncOnce(store, api, opts);
    expect(conflicted.conflicts).toBe(1);
    expect(await serverTask(created.id)).toMatchObject({ status: 'BLOCKED', notes: 'waiting for the crane', version: 4 }); // nothing overwritten
    expect(conflictCount(await store.listOutbox())).toBe(1);
    const view = (await loadTaskViews(store)).find((t) => t.id === created.id)!;
    expect(view.conflict?.conflict).toMatchObject({ version: 4, notes: 'waiting for the crane' });

    // resolve in favour of the device: re-based on version 4 under a NEW key, and the real server accepts it
    await resolveConflict(store, view.conflict!.id, 'mine');
    const resolved = await syncOnce(store, api, opts);
    expect(resolved).toMatchObject({ applied: 1, conflicts: 0 });
    expect(await serverTask(created.id)).toMatchObject({ status: 'DONE', notes: 'all finished', version: 5 });

    // ── proof photo: queued locally, uploaded by the next sync, then visible through pull ──
    const proof: LocalProof = { id: crypto.randomUUID(), taskId: created.id, fileUri: 'file:///proof.png', mimeType: 'image/png', latitude: 36.752887, longitude: 3.042048, capturedAt: new Date().toISOString(), status: 'PENDING', error: null, remote: null };
    await store.putProof(proof);
    const uploaded = await syncOnce(store, api, opts);
    expect(uploaded.uploaded).toBe(1);
    const [stored] = await store.listProofs(created.id);
    expect(stored).toMatchObject({ status: 'UPLOADED', remote: { id: proof.id, taskId: created.id, latitude: '36.752887', longitude: '3.042048', mimeType: 'image/png' } });
    const download = await fetch(`${API}${stored!.remote!.url}`, { headers: { authorization: `Bearer ${field.accessToken}` } });
    expect(download.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await download.arrayBuffer()), PNG)).toBe(0);
  }, 60_000);
});
