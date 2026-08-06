<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import LogPanel from '../components/LogPanel.vue';
import { api, runApi, state } from '../composables/useApi';

const { t } = useI18n();
const skill = ref('');
const title = ref('');
const category = ref('');
const tags = ref('');
const consumers = ref('agents,claude');
const sourceUrl = ref('');
const sourceSubpath = ref('');
const sourceRef = ref('');
const sourceCommit = ref('');
const names = computed(() => Object.keys(state.value?.registry?.skills || {}).sort());

function load(name: string) {
  skill.value = name;
  const entry = (state.value?.registry?.skills as any)?.[name] || {};
  title.value = entry.title || name;
  category.value = entry.category || 'experimental';
  tags.value = (entry.tags || []).join(',');
  consumers.value = (entry.consumers || []).join(',');
  sourceUrl.value = entry.source?.url || '';
  sourceSubpath.value = entry.source?.subpath || '';
  sourceRef.value = entry.source?.ref || '';
  sourceCommit.value = entry.source?.upstream_commit || '';
}

const save = () => runApi(() => api('/api/registry/edit', {
  method: 'POST',
  body: JSON.stringify({
    skill: skill.value,
    patch: {
      title: title.value,
      category: category.value,
      tags: tags.value.split(',').map((item) => item.trim()).filter(Boolean),
      consumers: consumers.value.split(',').map((item) => item.trim()).filter(Boolean),
      source: { url: sourceUrl.value, subpath: sourceSubpath.value, ref: sourceRef.value, upstream_commit: sourceCommit.value },
    },
  }),
}));
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('registry.title')">
      <template #subtitle>{{ t('registry.safeEdit') }}</template>
    </n-page-header>

    <n-grid :cols="2" :x-gap="18" :y-gap="18" responsive="screen">
      <n-gi>
        <n-card>
          <n-list hoverable clickable>
            <n-list-item v-for="name in names" :key="name" @click="load(name)">
              <n-thing :title="name" />
            </n-list-item>
          </n-list>
          <n-empty v-if="!names.length" :description="t('registry.noEntries')" />
        </n-card>
      </n-gi>
      <n-gi>
        <n-card :title="t('registry.editSkill')">
          <n-form label-placement="top">
            <n-form-item :label="t('common.skill')"><n-input v-model:value="skill" /></n-form-item>
            <n-form-item :label="t('common.title')"><n-input v-model:value="title" /></n-form-item>
            <n-form-item :label="t('common.category')"><n-input v-model:value="category" /></n-form-item>
            <n-form-item :label="t('common.tags')"><n-input v-model:value="tags" /></n-form-item>
            <n-form-item :label="t('common.consumers')"><n-input v-model:value="consumers" /></n-form-item>
            <n-form-item :label="t('common.sourceUrl')"><n-input v-model:value="sourceUrl" /></n-form-item>
            <n-form-item :label="t('common.sourceSubpath')"><n-input v-model:value="sourceSubpath" /></n-form-item>
            <n-form-item :label="t('common.sourceRef')"><n-input v-model:value="sourceRef" /></n-form-item>
            <n-form-item :label="t('common.upstreamCommit')"><n-input v-model:value="sourceCommit" /></n-form-item>
            <n-button type="primary" :disabled="!skill" @click="save">{{ t('common.save') }}</n-button>
          </n-form>
        </n-card>
      </n-gi>
    </n-grid>

    <LogPanel />
  </n-space>
</template>
