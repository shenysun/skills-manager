<script setup lang="ts">
import { reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import SourceCard from '../components/SourceCard.vue';
import LogPanel from '../components/LogPanel.vue';
import { api, runApi, state } from '../composables/useApi';

const { t } = useI18n();
const selectedBySource = reactive<Record<string, string[]>>({});
const loadingBySource = reactive<Record<string, boolean>>({});

function toggle(key: string, skill: string) {
  const list = selectedBySource[key] || (selectedBySource[key] = []);
  selectedBySource[key] = list.includes(skill) ? list.filter((item) => item !== skill) : [...list, skill];
}

async function update(key: string, skills?: string[]) {
  const loadingKey = `${key}:${skills ? 'selected' : 'all'}`;
  loadingBySource[loadingKey] = true;
  try {
    await runApi(() => api('/api/update/source', { method: 'POST', body: JSON.stringify({ key, skills }) }), { label: skills ? t('loading.updatingSourceSelected') : t('loading.updatingSource') });
  } finally {
    loadingBySource[loadingKey] = false;
  }
}
const discover = (url: string) => {
  localStorage.setItem('skills-manager-last-source', url);
  location.hash = '#/discover';
};
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('sources.title')">
      <template #subtitle>{{ t('sources.hint') }}</template>
    </n-page-header>
    <n-grid :cols="3" :x-gap="16" :y-gap="16" responsive="screen">
      <n-gi v-for="source in state?.sources" :key="source.key">
        <SourceCard :source="source" :selected="selectedBySource[source.key] || []" :loading-all="!!loadingBySource[`${source.key}:all`]" :loading-selected="!!loadingBySource[`${source.key}:selected`]" @toggle="toggle" @update="update" @discover="discover" />
      </n-gi>
    </n-grid>
    <n-empty v-if="!state?.sources?.length" :description="t('sources.noSources')" />
    <LogPanel />
  </n-space>
</template>
