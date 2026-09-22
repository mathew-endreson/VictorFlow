import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request context carried through async calls. The auth guard stores the acting user here and
 * DbService copies it into `app.user_id` for every write transaction, which is what the database
 * audit trigger records as the actor — services never have to pass "who did this" around by hand.
 */
export interface RequestStore {
  requestId: string;
  userId?: string;
}

export const requestStorage = new AsyncLocalStorage<RequestStore>();

export const currentUserId = (): string | undefined => requestStorage.getStore()?.userId;

export function setCurrentUser(userId: string): void {
  const store = requestStorage.getStore();
  if (store) store.userId = userId;
}

export function requestContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  requestStorage.run({ requestId: randomUUID() }, next);
}
