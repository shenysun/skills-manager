<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxViewport,
} from 'reka-ui';

/** Quiet inline "search to add" combobox (typographic flow): underline input
 *  whose portaled list filters as you type. No selected state — picking an
 *  option emits and the control resets to its placeholder. */
const props = defineProps<{
  placeholder: string;
  emptyText: string;
  options: Array<{ value: string; label: string }>;
}>();
const emit = defineEmits<{ select: [value: string] }>();

const query = ref('');

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(needle));
});

function onSelect(value: unknown) {
  if (typeof value !== 'string') return;
  query.value = ''; // back to the placeholder — the choice lives in the list below
  emit('select', value);
}
</script>

<template>
  <ComboboxRoot :ignore-filter="true" open-on-focus @update:model-value="onSelect">
    <ComboboxAnchor class="block w-[min(22rem,100%)]">
      <ComboboxInput
        class="w-full border-b border-line bg-transparent py-[4px] pr-[2px] pl-[2px] text-[13px] text-fg outline-none placeholder:text-fg3 focus:border-accent"
        :display-value="() => query"
        :placeholder="placeholder"
        @update:model-value="query = String($event)"
      />
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        class="z-[601] max-h-[280px] w-[var(--reka-combobox-trigger-width)] overflow-hidden rounded-[8px] border border-line bg-bg shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
        position="popper"
        :side-offset="4"
      >
        <ComboboxViewport class="overflow-y-auto py-[4px]">
          <ComboboxEmpty class="px-[12px] py-[10px] text-center text-[13px] text-fg3">
            {{ emptyText }}
          </ComboboxEmpty>
          <ComboboxItem
            v-for="option in filtered"
            :key="option.value"
            class="block cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap px-[12px] py-[6px] text-[13px] text-fg outline-none data-[highlighted]:bg-line2"
            :value="option.value"
            :text-value="option.label"
          >
            {{ option.label }}
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
