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
import type { ActivityRecord } from '../api/client';
import { acquireDialogScrollLock, releaseDialogScrollLock } from '../composables/dialogScrollLock';

defineProps<{ records: ActivityRecord[] }>();
const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(locale.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function onOpenChange(open: boolean) {
  if (!open) emit('close');
}

onMounted(() => acquireDialogScrollLock());
onUnmounted(() => releaseDialogScrollLock());
</script>

<template>
  <DialogRoot :open="true" modal @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[450] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)]" />
      <DialogContent
        class="fixed top-0 right-0 bottom-0 z-[451] w-[min(420px,92vw)] overflow-y-auto border-l border-line bg-bg px-[22px] py-[20px] shadow-[-12px_0_32px_rgba(0,0,0,0.12)]"
        :aria-describedby="undefined"
      >
        <div class="mb-[10px] flex min-w-0 items-baseline gap-[10px]">
          <DialogTitle as="h2" class="mr-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-semibold">
            {{ t('log.title') }}
          </DialogTitle>
          <DialogClose class="shrink-0 text-[13px] text-fg3 hover:text-fg" :aria-label="t('chrome.close')">✕</DialogClose>
        </div>
        <p v-if="records.length === 0" class="my-[8px] text-[13px] text-fg3">{{ t('log.empty') }}</p>
        <div v-else>
          <p
            v-for="record in records"
            :key="record.id"
            class="flex items-baseline gap-[10px] border-b border-line2 py-[8px] text-[13px]"
          >
            <span class="whitespace-nowrap tabular-nums text-fg3">{{ formatTime(record.timestamp) }}</span>
            <span class="mono whitespace-nowrap text-fg2">{{ record.action }}</span>
            <span class="overflow-hidden text-ellipsis text-fg2">{{ record.summary }}</span>
          </p>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
