<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DiscoverWizard from '../components/DiscoverWizard.vue';
import SourceCard from '../components/SourceCard.vue';
import { api, state } from '../composables/useApi';
import { useOperationNotification } from '../composables/useOperationNotification';
import { sourcesTabFromHash, type SourcesTab } from '../routing/resolveDashboardHash';

const { t } = useI18n();
const { runWithNotification } = useOperationNotification();
const selectedBySource = reactive<Record<string, string[]>>({});
const loadingBySource = reactive<Record<string, boolean>>({});
const search = ref('');
const tab = ref<SourcesTab>(sourcesTabFromHash(location.hash));
const discoverSource = ref('');

function syncTabFromHash() {
  tab.value = sourcesTabFromHash(location.hash);
}

onMounted(() => {
  syncTabFromHash();
  window.addEventListener('hashchange', syncTabFromHash);
});
onUnmounted(() => {
  window.removeEventListener('hashchange', syncTabFromHash);
});

const filteredSources = computed(() => {
  const query = search.value.trim().toLowerCase();
  const sources = state.value?.sources || [];
  if (!query) return sources;
  return sources.filter((source) => [
    source.url,
    source.ref || '',
    ...source.skills.flatMap((skill) => [skill.skill, skill.subpath, skill.title || '', skill.description || '']),
  ].some((value) => value.toLowerCase().includes(query)));
});

const filteredSkillCount = computed(() => filteredSources.value.reduce((sum, source) => sum + source.skills.length, 0));
const selectedTotal = computed(() => Object.values(selectedBySource).reduce((sum, list) => sum + list.length, 0));

function sourceSelection(key: string) {
  return selectedBySource[key] || [];
}

function toggle(key: string, skill: string, checked: boolean) {
  const list = selectedBySource[key] || [];
  selectedBySource[key] = checked ? Array.from(new Set([...list, skill])) : list.filter((item) => item !== skill);
}

function selectAllSource(key: string) {
  const source = state.value?.sources.find((item) => item.key === key);
  selectedBySource[key] = source?.skills.map((candidate) => candidate.skill) || [];
}

function clearSource(key: string) {
  selectedBySource[key] = [];
}

async function update(key: string, skills?: string[]) {
  const loadingKey = `${key}:${skills ? 'selected' : 'all'}`;
  loadingBySource[loadingKey] = true;
  try {
    await runWithNotification(() => api('/api/update/source', { method: 'POST', body: JSON.stringify({ key, skills }) }), { loading: skills ? t('loading.updatingSourceSelected') : t('loading.updatingSource'), success: t('notification.updateDone'), error: t('notification.failed') });
  } finally {
    loadingBySource[loadingKey] = false;
  }
}

const discover = (url: string) => {
  discoverSource.value = url;
  location.hash = '#/sources?tab=discover';
};

function rememberTab(value: string | number) {
  const next = value === 'discover' ? 'discover' : 'library';
  tab.value = next;
  location.hash = next === 'discover' ? '#/sources?tab=discover' : '#/sources';
}
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('sources.title')">
      <template #subtitle>{{ t('sources.hint') }}</template>
    </n-page-header>

    <n-tabs v-model:value="tab" type="segment" animated @update:value="rememberTab">
      <n-tab-pane name="library" :tab="t('sources.libraryTab')">
        <n-space vertical size="medium">
          <n-card class="source-library-hero" size="small">
            <n-space align="center" justify="space-between" wrap>
              <div class="action-center-copy">
                <n-text strong>{{ t('sources.libraryTitle') }}</n-text>
                <n-text depth="3">{{ t('sources.libraryHint') }}</n-text>
              </div>
              <n-space align="center" wrap>
                <n-tag round>{{ t('sources.sourceCount', { count: filteredSources.length }) }}</n-tag>
                <n-tag round>{{ t('sources.totalSkills', { count: filteredSkillCount }) }}</n-tag>
                <n-tag type="info" round>{{ t('sources.selectedCount', { count: selectedTotal }) }}</n-tag>
              </n-space>
            </n-space>
            <n-input v-model:value="search" clearable :placeholder="t('sources.searchPlaceholder')" class="source-search" />
          </n-card>

          <div v-if="filteredSources.length" class="source-card-list">
            <SourceCard
              v-for="source in filteredSources"
              :key="source.key"
              :source="source"
              :selected="sourceSelection(source.key)"
              :loading-all="!!loadingBySource[`${source.key}:all`]"
              :loading-selected="!!loadingBySource[`${source.key}:selected`]"
              @toggle="toggle"
              @select-all="selectAllSource"
              @clear="clearSource"
              @update="update"
              @discover="discover"
            />
          </div>
          <n-empty v-else :description="t('sources.noSources')" />
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="discover" :tab="t('sources.discoverTab')">
        <DiscoverWizard :preset-source="discoverSource" />
      </n-tab-pane>
    </n-tabs>
  </n-space>
</template>
