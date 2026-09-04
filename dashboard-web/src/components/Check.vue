<script setup lang="ts">
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui';

defineProps<{ checked?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <CheckboxRoot
    :model-value="checked ?? false"
    :disabled="disabled"
    class="inline-flex size-[15px] shrink-0 items-center justify-center rounded-[3px] border border-fg3 text-[10px] leading-none text-bg data-[state=checked]:border-accent data-[state=checked]:bg-accent"
    @update:model-value="emit('toggle')"
  >
    <CheckboxIndicator>✓</CheckboxIndicator>
  </CheckboxRoot>
</template>
