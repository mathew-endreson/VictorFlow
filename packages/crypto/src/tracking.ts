import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison.
 * `timingSafeEqual` throws on unequal lengths, so lengths are compared first — the length
 * of a fixed-size digest is public information, the content is not.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Public tracking token for an order:
 *   base64url( HMAC-SHA256( key = serverSecret, msg = orderId ‖ 0x0A ‖ customerId ) )
 *
 * It is a keyed MAC, not a bare hash of the secret, so it cannot be length-extended and the
 * secret never leaves the server. Knowing one order's token reveals nothing about another's.
 */
export function trackingToken(serverSecret: string, orderId: string, customerId: string): string {
  if (!serverSecret) throw new Error('trackingToken: serverSecret must not be empty');
  return createHmac('sha256', serverSecret).update(`${orderId}\n${customerId}`).digest('base64url');
}

export function verifyTrackingToken(
  serverSecret: string,
  orderId: string,
  customerId: string,
  presented: string,
): boolean {
  return constantTimeEqual(trackingToken(serverSecret, orderId, customerId), presented);
}
