// Binds the pure sync engine to this device's runtime. Hermes does not guarantee globalThis.crypto.randomUUID, so the
// idempotency keys come from expo-crypto instead.
import * as Crypto from 'expo-crypto';
import type { TaskChanges } from '@victorflow/types';
import { queueTaskEdit, resolveConflict, syncOnce } from './engine';
import type { SyncApi, SyncReport, SyncStore } from './types';

const makeKey = () => Crypto.randomUUID();

export const newProofId = makeKey;

export const queueEdit = (store: SyncStore, taskId: string, changes: TaskChanges) => queueTaskEdit(store, taskId, changes, () => new Date(), makeKey);

export const resolve = (store: SyncStore, outboxId: string, choice: 'server' | 'mine') => resolveConflict(store, outboxId, choice, makeKey);

export const runSync = (store: SyncStore, api: SyncApi, deviceId: string): Promise<SyncReport> => syncOnce(store, api, { deviceId, makeKey });
