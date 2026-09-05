<script setup lang="ts">
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';

defineProps<{ title: string; wide?: boolean; side?: 'right' }>();
const emit = defineEmits<{ closed: [] }>();
const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();

// Body scroll lock: Reka's modal Dialog already owns it (nested layers counted,
// original overflow restored on last close); `scrollbar-gutter: stable` in
// tokens.css keeps the page from shifting. Do not add a second lock writer.
watch(open, (value, previous) => {
  if (!value && previous) emit('closed');
});
</script>

<template>
  <DialogRoot v-model:open="open" modal>
    <DialogPortal>
      <DialogOverlay class="sheet-overlay" :class="side === 'right' ? 'log-overlay' : ''" />
      <DialogContent
        :class="[
          side === 'right' ? 'log-panel' : 'sheet-place',
          side !== 'right' && !wide ? 'sheet max-h-[84vh] overflow-y-auto' : '',
          side !== 'right' && wide ? 'sheet sheet-wide' : '',
        ]"
        :aria-describedby="undefined"
      >
        <div class="sheet-head" :class="wide ? 'shrink-0' : ''">
          <DialogTitle as="h2" class="sheet-title">{{ title }}</DialogTitle>
          <slot name="head" />
          <DialogClose class="sheet-close" :aria-label="t('chrome.close')">✕</DialogClose>
        </div>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
