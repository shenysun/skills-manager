<script setup lang="ts">
import { onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { acquireDialogScrollLock, releaseDialogScrollLock } from '../composables/dialogScrollLock';

defineProps<{ title: string; wide?: boolean; side?: 'right' }>();
const emit = defineEmits<{ closed: [] }>();
const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();

// Nested-dialog scroll lock (CONTEXT.md): the shared counter keeps the body
// locked until the last sheet closes — tied to open transitions, not mounts.
watch(
  open,
  (value, previous) => {
    if (value) {
      acquireDialogScrollLock();
      return;
    }
    if (previous) {
      releaseDialogScrollLock();
      emit('closed');
    }
  },
  { immediate: true },
);
// The parent may end the session while we are still open (v-if pull after an
// apply); release what this instance acquired.
onUnmounted(() => {
  if (open.value) releaseDialogScrollLock();
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
