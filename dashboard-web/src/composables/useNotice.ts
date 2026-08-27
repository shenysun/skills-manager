import { ref } from 'vue';

export type Notice = { kind: 'ok' | 'error'; text: string };

const notice = ref<Notice | null>(null);
let timer: number | undefined;

/** Operation feedback as one transient bottom-center toast (visual baseline
 *  2026-08-27): a single slot — a new notice replaces the previous one. */
export function useNotice() {
  function show(kind: Notice['kind'], text: string, ttl = 4000) {
    notice.value = { kind, text };
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      notice.value = null;
    }, ttl);
  }
  return { notice, show };
}
