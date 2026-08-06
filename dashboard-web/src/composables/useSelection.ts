import { ref } from 'vue';
export function useSelection() {
  const selected = ref<string[]>([]);
  const toggleAll = (values: string[], checked: boolean) => { selected.value = checked ? [...values] : []; };
  return { selected, toggleAll };
}
