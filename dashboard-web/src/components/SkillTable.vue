<script setup lang="ts">
import { computed, h } from 'vue';
import { useI18n } from 'vue-i18n';
import { NCheckbox, NCode, NEllipsis, NSpace, NText, type DataTableColumns } from 'naive-ui';
import ConsumerBadges from './ConsumerBadges.vue';
import type { Skill } from '../composables/useApi';

const props = defineProps<{ skills: Skill[]; selected?: string[] }>();
const emit = defineEmits<{ toggle: [name: string]; open: [skill: Skill] }>();
const { t } = useI18n();

const columns = computed<DataTableColumns<Skill>>(() => [
  {
    title: '',
    key: 'selected',
    width: 48,
    render: (skill) => h(NCheckbox, {
      checked: props.selected?.includes(skill.name) || false,
      onClick: (event: MouseEvent) => event.stopPropagation(),
      'onUpdate:checked': () => emit('toggle', skill.name),
    }),
  },
  {
    title: t('common.skill'),
    key: 'skill',
    minWidth: 220,
    render: (skill) => h(NSpace, { vertical: true, size: 2 }, {
      default: () => [
        h(NText, { strong: true }, { default: () => skill.name }),
        h(NText, { depth: 3 }, { default: () => skill.description || skill.title || '—' }),
      ],
    }),
  },
  { title: t('common.category'), key: 'category', width: 140, render: (skill) => skill.category || '—' },
  { title: t('common.consumers'), key: 'consumers', width: 190, render: (skill) => h(ConsumerBadges, { consumers: skill.consumers || [] }) },
  {
    title: t('common.source'),
    key: 'source',
    minWidth: 260,
    render: (skill) => h(NSpace, { vertical: true, size: 2 }, {
      default: () => [
        h(NEllipsis, { style: 'max-width: 360px' }, { default: () => skill.source?.url || t('common.local') }),
        h(NCode, { code: skill.source?.subpath || skill.path || '—', wordWrap: true }),
      ],
    }),
  },
]);

const rowProps = (skill: Skill) => ({
  style: 'cursor: pointer',
  onClick: () => emit('open', skill),
});
</script>

<template>
  <n-data-table :columns="columns" :data="skills" :row-key="(row: Skill) => row.name" :row-props="rowProps" size="small" :bordered="false" />
</template>
