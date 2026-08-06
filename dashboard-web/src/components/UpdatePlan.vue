<script setup lang="ts">
import { computed, h } from 'vue';
import { useI18n } from 'vue-i18n';
import { NCode, NSpace, type DataTableColumns } from 'naive-ui';
import type { UpdateCandidate } from '../composables/useApi';

defineProps<{ candidates: UpdateCandidate[] }>();

const { t } = useI18n();
const columns = computed<DataTableColumns<UpdateCandidate>>(() => [
  { title: t('common.skill'), key: 'skill', minWidth: 180 },
  {
    title: t('common.source'),
    key: 'source',
    minWidth: 260,
    render: (candidate) => h(NSpace, { vertical: true, size: 2 }, {
      default: () => [candidate.url, candidate.ref ? `#${candidate.ref}` : null],
    }),
  },
  { title: t('common.path'), key: 'subpath', minWidth: 220, render: (candidate) => h(NCode, { code: candidate.subpath, wordWrap: true }) },
]);
</script>

<template>
  <n-data-table :columns="columns" :data="candidates" :row-key="(row: UpdateCandidate) => row.skill" size="small" :bordered="false" />
</template>
