<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SourceGroup } from '../composables/useApi';

const props = defineProps<{ source: SourceGroup; selected: string[]; loadingAll?: boolean; loadingSelected?: boolean }>();
defineEmits<{ update: [key: string, skills?: string[]]; discover: [url: string]; toggle: [key: string, skill: string, checked: boolean]; selectAll: [key: string]; clear: [key: string] }>();

const { t } = useI18n();
const selectedCount = computed(() => props.selected.length);
const isAllSelected = computed(() => props.source.skills.length > 0 && selectedCount.value === props.source.skills.length);
</script>

<template>
  <n-card class="source-card-v2" size="small">
    <div class="source-card-head">
      <div class="source-card-title">
        <n-ellipsis class="source-url">{{ source.url }}</n-ellipsis>
        <div class="source-meta-row">
          <n-tag v-if="source.ref" size="small" round>{{ source.ref }}</n-tag>
          <n-tag size="small" round>{{ t('sources.skillCount', { count: source.skills.length }) }}</n-tag>
          <n-tag :type="selectedCount ? 'info' : 'default'" size="small" round>{{ t('sources.selectedCount', { count: selectedCount }) }}</n-tag>
        </div>
      </div>
      <n-space wrap justify="end" class="source-card-actions">
        <n-button size="small" secondary :disabled="isAllSelected" @click="$emit('selectAll', source.key)">{{ t('sources.selectAllInSource') }}</n-button>
        <n-button size="small" secondary :disabled="!selectedCount" @click="$emit('clear', source.key)">{{ t('sources.clearSourceSelection') }}</n-button>
        <n-button size="small" :loading="loadingAll" @click="$emit('update', source.key)">{{ t('sources.updateAll') }}</n-button>
        <n-button size="small" type="primary" :disabled="!selectedCount" :loading="loadingSelected" @click="$emit('update', source.key, selected)">{{ t('sources.updateSelected') }}</n-button>
        <n-button size="small" tertiary @click="$emit('discover', source.url)">{{ t('sources.discoverMore') }}</n-button>
      </n-space>
    </div>

    <div class="source-skill-list-v2">
      <label v-for="candidate in source.skills" :key="candidate.skill" class="source-skill-card">
        <n-checkbox :checked="selected.includes(candidate.skill)" @update:checked="(checked: boolean) => $emit('toggle', source.key, candidate.skill, checked)" />
        <span class="source-skill-body">
          <span class="source-skill-name">{{ candidate.skill }}</span>
          <span v-if="candidate.description || candidate.title" class="source-skill-desc">{{ candidate.description || candidate.title }}</span>
          <n-code :code="candidate.subpath" word-wrap class="source-skill-path" />
        </span>
      </label>
    </div>
  </n-card>
</template>
