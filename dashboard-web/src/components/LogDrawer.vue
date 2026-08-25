<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActivityRecord } from '../api/client';

defineProps<{ records: ActivityRecord[] }>();
const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(locale.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="drawer-overlay" @click.self="emit('close')"></div>
    <aside class="log-drawer">
      <div class="sheet-head">
        <h2>{{ t('log.title') }}</h2>
        <button class="sheet-close" @click="emit('close')">✕</button>
      </div>
      <p v-if="records.length === 0" class="picker-hint">{{ t('log.empty') }}</p>
      <div v-else class="log-list">
        <p v-for="record in records" :key="record.id" class="log-line">
          <span class="log-time">{{ formatTime(record.timestamp) }}</span>
          <span class="log-action mono">{{ record.action }}</span>
          <span class="log-summary">{{ record.summary }}</span>
        </p>
      </div>
    </aside>
  </Teleport>
</template>
