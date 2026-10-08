import { uuidv7 } from 'uuidv7';

/** Time-sortable id, generated on the client so no server round trip is needed. */
export function newId(): string {
  return uuidv7();
}

export function nowIso(): string {
  return new Date().toISOString();
}
