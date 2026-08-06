<script setup lang="ts">
import { h } from 'vue';
import { NCode, NSpace, type DataTableColumns } from 'naive-ui';
import type { UpdateCandidate } from '../composables/useApi';

defineProps<{ candidates: UpdateCandidate[] }>();

const columns: DataTableColumns<UpdateCandidate> = [
  { title: 'Skill', key: 'skill', minWidth: 180 },
  {
    title: 'Source',
    key: 'source',
    minWidth: 260,
    render: (candidate) => h(NSpace, { vertical: true, size: 2 }, {
      default: () => [candidate.url, candidate.ref ? `#${candidate.ref}` : null],
    }),
  },
  { title: 'Path', key: 'subpath', minWidth: 220, render: (candidate) => h(NCode, { code: candidate.subpath, wordWrap: true }) },
];
</script>

<template>
  <n-data-table :columns="columns" :data="candidates" :row-key="(row: UpdateCandidate) => row.skill" size="small" :bordered="false" />
</template>
