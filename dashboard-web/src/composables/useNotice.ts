import { ref } from 'vue';

export type Notice = { kind: 'ok' | 'error'; text: string };

const notice = ref<Notice | null>(null);
let timer: number | undefined;

/** One transient document-style line for operation feedback — no toasts chrome. */
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
