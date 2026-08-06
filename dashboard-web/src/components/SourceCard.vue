<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { SourceGroup } from '../composables/useApi';

defineProps<{ source: SourceGroup; selected: string[] }>();
defineEmits<{ update: [key: string, skills?: string[]]; discover: [url: string]; toggle: [key: string, skill: string] }>();

const { t } = useI18n();
</script>

<template>
  <n-card class="source-card" size="small">
    <template #header>
      <n-space align="center" justify="space-between">
        <n-ellipsis style="max-width: 520px">{{ source.url }}</n-ellipsis>
        <n-tag v-if="source.ref" size="small" round>{{ source.ref }}</n-tag>
      </n-space>
    </template>

    <n-space vertical>
      <n-list hoverable clickable>
        <n-list-item v-for="candidate in source.skills" :key="candidate.skill">
          <n-checkbox :checked="selected.includes(candidate.skill)" @update:checked="$emit('toggle', source.key, candidate.skill)">
            <n-space vertical :size="2">
              <n-text strong>{{ candidate.skill }}</n-text>
              <n-code :code="candidate.subpath" word-wrap />
            </n-space>
          </n-checkbox>
        </n-list-item>
      </n-list>

      <n-space wrap>
        <n-button @click="$emit('update', source.key)">{{ t('sources.updateAll') }}</n-button>
        <n-button :disabled="!selected.length" type="primary" @click="$emit('update', source.key, selected)">{{ t('sources.updateSelected') }}</n-button>
        <n-button tertiary @click="$emit('discover', source.url)">{{ t('sources.discoverMore') }}</n-button>
      </n-space>
    </n-space>
  </n-card>
</template>
