<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NPopover, NSpace, NTag, NText } from 'naive-ui';
import { state } from '../composables/useApi';

type Entry = { skill: string; runtimePath: string; mode: string; agents: string[] };

const props = defineProps<{ skill: string }>();
const { t } = useI18n();

/** Physical-first badges: one chip per runtime dir this skill is wired into, agent ids on drill-down. */
const entries = computed<Entry[]>(() => {
  const records = state.value?.distributions;
  if (!records) return [];
  const all = [...(records.user?.entries || []), ...records.projects.flatMap((record: { entries: Entry[] }) => record.entries || [])];
  const perPath = new Map<string, Entry>();
  for (const entry of all as Entry[]) {
    if (entry.skill !== props.skill) continue;
    perPath.set(entry.runtimePath, entry);
  }
  return [...perPath.values()].sort((a, b) => a.runtimePath.localeCompare(b.runtimePath));
});

function chipLabel(entry: Entry) {
  const dir = entry.runtimePath.replace(/[\\/][^\\/]+$/, '');
  const name = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
  return `${name} (${entry.agents.length})`;
}
</script>

<template>
  <n-space v-if="entries.length" :size="4" inline>
    <n-popover v-for="entry in entries" :key="entry.runtimePath" trigger="hover">
      <template #trigger>
        <n-tag size="small" round :type="entry.mode === 'symlink' ? 'info' : 'success'">{{ chipLabel(entry) }}</n-tag>
      </template>
      <n-space vertical size="2">
        <n-text code style="font-size: 12px">{{ entry.runtimePath }}</n-text>
        <n-text depth="3" style="font-size: 12px">{{ t('distribution.mode') }}: {{ entry.mode }}</n-text>
        <n-text style="font-size: 12px">{{ t('distribution.agents') }}: {{ entry.agents.join(', ') }}</n-text>
      </n-space>
    </n-popover>
  </n-space>
  <n-text v-else depth="3">—</n-text>
</template>
