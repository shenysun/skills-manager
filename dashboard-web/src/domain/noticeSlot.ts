export type Notice = { kind: 'ok' | 'error'; text: string };

export type NoticeSlot = {
  notice: Notice | null;
  dismissAt: number | null;
};

export const DEFAULT_NOTICE_TTL_MS = 4000;

export const idleNotice: NoticeSlot = { notice: null, dismissAt: null };

/** Single slot: a new show replaces whatever was there. TTL is a parameter. */
export function showNotice(
  _previous: NoticeSlot,
  kind: Notice['kind'],
  text: string,
  now: number,
  ttl = DEFAULT_NOTICE_TTL_MS,
): NoticeSlot {
  return { notice: { kind, text }, dismissAt: now + ttl };
}

export function expireNotice(slot: NoticeSlot, now: number): NoticeSlot {
  if (slot.dismissAt === null || now < slot.dismissAt) return slot;
  return idleNotice;
}
