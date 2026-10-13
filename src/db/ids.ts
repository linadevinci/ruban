import { uuidv7 } from 'uuidv7';

/** Time-sortable id, generated on the client so no server round trip is needed. */
export function newId(): string {
  return uuidv7();
}

let lastNowMs = 0;

/**
 * Never returns a value less than or equal to its previous return. Spec 7
 * applies a change only where updatedAt is STRICTLY newer, so two writes to
 * one record in the same millisecond would otherwise see the second dropped
 * server-side while being applied locally.
 */
export function nowIso(): string {
  const ms = Math.max(Date.now(), lastNowMs + 1);
  lastNowMs = ms;
  return new Date(ms).toISOString();
}
