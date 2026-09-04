import { computed, ref } from 'vue';
import { DEFAULT_NOTICE_TTL_MS, expireNotice, idleNotice, showNotice, type Notice } from '../domain/noticeSlot';

export type { Notice };

const slot = ref(idleNotice);
let timer: number | undefined;

/** Operation feedback as one transient bottom-center toast (visual baseline
 *  2026-08-27): a single slot — a new notice replaces the previous one. */
export function useNotice() {
  function show(kind: Notice['kind'], text: string, ttl = DEFAULT_NOTICE_TTL_MS) {
    slot.value = showNotice(slot.value, kind, text, Date.now(), ttl);
    window.clearTimeout(timer);
    const dismissAt = slot.value.dismissAt ?? Date.now() + ttl;
    timer = window.setTimeout(() => {
      slot.value = expireNotice(slot.value, Date.now());
    }, Math.max(0, dismissAt - Date.now()));
  }
  const notice = computed(() => slot.value.notice);
  return { notice, show };
}
