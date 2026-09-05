<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import type { ActivityRecord } from '../api/client';

defineProps<{ records: ActivityRecord[] }>();
const open = defineModel<boolean>('open', { default: false });

const { t, locale } = useI18n();

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(locale.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <Sheet side="right" :title="t('log.title')" v-model:open="open">
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
  </Sheet>
</template>
