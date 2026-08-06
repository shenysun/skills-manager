<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NButtonGroup, NCheckbox, NCode, NEllipsis, NSpace, NTag, NText, type DataTableColumns } from 'naive-ui';
import LogPanel from '../components/LogPanel.vue';
import { api, state, type SourceGroup, type UpdateCandidate } from '../composables/useApi';
import { useOperationNotification } from '../composables/useOperationNotification';

const { t } = useI18n();
const { runWithNotification } = useOperationNotification();
const selectedBySource = reactive<Record<string, string[]>>({});
const loadingBySource = reactive<Record<string, boolean>>({});
const search = ref('');

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

function sourceSelection(key: string) {
  return selectedBySource[key] || [];
}

function toggle(key: string, skill: string) {
  const list = selectedBySource[key] || (selectedBySource[key] = []);
  selectedBySource[key] = list.includes(skill) ? list.filter((item) => item !== skill) : [...list, skill];
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
  localStorage.setItem('skills-manager-last-source', url);
  location.hash = '#/discover';
};

function renderSkill(source: SourceGroup, candidate: UpdateCandidate) {
  return h('div', { class: 'source-skill-row' }, [
    h(NCheckbox, {
      checked: sourceSelection(source.key).includes(candidate.skill),
      'onUpdate:checked': () => toggle(source.key, candidate.skill),
    }),
    h('div', { class: 'source-skill-main' }, [
      h(NText, { strong: true }, { default: () => candidate.skill }),
      h(NCode, { code: candidate.subpath, wordWrap: true }),
    ]),
  ]);
}

const columns = computed<DataTableColumns<SourceGroup>>(() => [
  { type: 'expand', renderExpand: (source) => h('div', { class: 'source-expand' }, source.skills.map((candidate) => renderSkill(source, candidate))) },
  {
    title: t('sources.sourceColumn'),
    key: 'source',
    minWidth: 360,
    render: (source) => h(NSpace, { vertical: true, size: 3 }, {
      default: () => [
        h(NEllipsis, { style: 'max-width: 640px' }, { default: () => source.url }),
        source.ref ? h(NTag, { size: 'small', round: true }, { default: () => source.ref }) : null,
      ],
    }),
  },
  {
    title: t('sources.skillsColumn'),
    key: 'skills',
    width: 130,
    render: (source) => h(NTag, { round: true, size: 'small' }, { default: () => t('sources.skillCount', { count: source.skills.length }) }),
  },
  {
    title: t('sources.selectedColumn'),
    key: 'selected',
    width: 140,
    render: (source) => {
      const count = sourceSelection(source.key).length;
      return h(NText, { depth: count ? 1 : 3 }, { default: () => count ? t('sources.selectedCount', { count }) : t('sources.noSelection') });
    },
  },
  {
    title: t('sources.actionsColumn'),
    key: 'actions',
    width: 330,
    render: (source) => h(NButtonGroup, null, {
      default: () => [
        h(NButton, { loading: !!loadingBySource[`${source.key}:all`], onClick: (event: MouseEvent) => { event.stopPropagation(); update(source.key); } }, { default: () => t('sources.updateAll') }),
        h(NButton, { type: 'primary', disabled: !sourceSelection(source.key).length, loading: !!loadingBySource[`${source.key}:selected`], onClick: (event: MouseEvent) => { event.stopPropagation(); update(source.key, sourceSelection(source.key)); } }, { default: () => t('sources.updateSelected') }),
        h(NButton, { tertiary: true, onClick: (event: MouseEvent) => { event.stopPropagation(); discover(source.url); } }, { default: () => t('sources.discoverMore') }),
      ],
    }),
  },
]);
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('sources.title')">
      <template #subtitle>{{ t('sources.hint') }}</template>
    </n-page-header>

    <n-card>
      <n-space vertical size="medium">
        <n-space align="center" justify="space-between" wrap>
          <n-input v-model:value="search" clearable :placeholder="t('sources.searchPlaceholder')" style="max-width: 520px" />
          <n-text depth="3">{{ t('sources.expandHint') }}</n-text>
        </n-space>
        <n-data-table :columns="columns" :data="filteredSources" :row-key="(row: SourceGroup) => row.key" size="small" :bordered="false" />
        <n-empty v-if="!filteredSources.length" :description="t('sources.noSources')" />
      </n-space>
    </n-card>

    <LogPanel />
  </n-space>
</template>
