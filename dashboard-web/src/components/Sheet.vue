<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
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

defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ cancel: [] }>();
const { t } = useI18n();

function onOpenChange(open: boolean) {
  if (!open) emit('cancel');
}

onMounted(() => acquireDialogScrollLock());
onUnmounted(() => releaseDialogScrollLock());
</script>

<template>
  <DialogRoot :open="true" modal @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="sheet-overlay">
        <DialogContent
          class="sheet"
          :class="wide ? 'sheet-wide' : ''"
          :aria-describedby="undefined"
          @pointer-down-outside="
            (event) => {
              const original = event.detail.originalEvent;
              const target = original.target as HTMLElement;
              if (original.offsetX > target.clientWidth || original.offsetY > target.clientHeight) {
                event.preventDefault();
              }
            }
          "
        >
          <div class="sheet-head" :class="wide ? 'shrink-0' : ''">
            <DialogTitle as="h2" class="sheet-title">{{ title }}</DialogTitle>
            <slot name="head" />
            <DialogClose class="sheet-close" :aria-label="t('chrome.close')">✕</DialogClose>
          </div>
          <slot />
        </DialogContent>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
