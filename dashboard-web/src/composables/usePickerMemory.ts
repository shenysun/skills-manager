import { ref } from 'vue';
import { rememberApply as writeMemory, type PickerMemory, type Scope } from '../domain/picker';

/** Per-scope picker memory: written only on confirm, so it equals exactly the last confirmed apply (ADR-0004 §7). */
const memory = ref<PickerMemory>({});

export function usePickerMemory() {
  function rememberApply(scope: Scope, applied: readonly string[]) {
    memory.value = writeMemory(memory.value, scope, applied);
  }
  return { memory, rememberApply };
}
