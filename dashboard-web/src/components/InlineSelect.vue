<script setup lang="ts">
import type { AcceptableValue } from 'reka-ui';
import {
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui';

/** Quiet inline select (typographic flow): text trigger + portaled list.
 *  Uncontrolled-visible only — `modelValue` stays undefined for an
 *  always-placeholder picker (the prefer-add control); bind v-model for a
 *  persistent choice (the per-conflict resolve control). */
const props = defineProps<{
  modelValue?: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

function onSelect(value: AcceptableValue) {
  if (typeof value === 'string') emit('update:modelValue', value);
}
</script>

<template>
  <SelectRoot :model-value="modelValue" @update:model-value="onSelect">
    <SelectTrigger
      class="ml-[0.5rem] max-w-[22rem] overflow-hidden text-ellipsis align-bottom text-fg2 hover:text-fg"
      :aria-label="placeholder"
    >
      <SelectValue class="data-[placeholder]:text-fg3" :placeholder="placeholder" />
      <span class="ml-[2px] text-fg3" aria-hidden="true">▾</span>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        class="z-[601] max-h-[280px] overflow-hidden rounded-[8px] border border-line bg-bg py-[4px] shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
        position="popper"
        :side-offset="4"
      >
        <SelectViewport>
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap px-[12px] py-[6px] text-[13px] text-fg outline-none data-[state=checked]:text-accent data-[highlighted]:bg-line2"
          >
            {{ option.label }}
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
