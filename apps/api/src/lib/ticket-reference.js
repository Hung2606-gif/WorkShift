import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config.js';

const referencePattern = /WS-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{20})/i;

function tag(ticketId) {
  return createHmac('sha256', getConfig().appJwtSecret).update(`support-ticket-reply:${ticketId}`).digest('hex').slice(0, 20);
}

/**
 * Signed reference sent in a ticket's emails. Quoting it back proves the
 * sender received that email, which a forged From address cannot.
 */
export function ticketReference(ticketId) {
  return `WS-${ticketId}-${tag(ticketId)}`;
}

/** The ticket ID of the first correctly signed reference in `text`, or null. */
export function ticketIdFromReference(text) {
  const match = String(text ?? '').match(referencePattern);
  if (!match) return null;
  const ticketId = match[1].toLowerCase();
  const expected = Buffer.from(tag(ticketId));
  const received = Buffer.from(match[2].toLowerCase());
  return expected.length === received.length && timingSafeEqual(expected, received) ? ticketId : null;
}
