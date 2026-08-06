<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import UpdatePlan from '../components/UpdatePlan.vue';
import DiscoverWizard from '../components/DiscoverWizard.vue';
import LogPanel from '../components/LogPanel.vue';
import { api, runApi, state } from '../composables/useApi';

const { t } = useI18n();
const tab = ref('skill');
const selected = ref<string[]>([]);

const updateSkills = () => runApi(() => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills: selected.value }) }));
const updateSource = (key: string) => runApi(() => api('/api/update/source', { method: 'POST', body: JSON.stringify({ key }) }));
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('updates.title')" />
    <n-tabs v-model:value="tab" type="segment" animated>
      <n-tab-pane name="skill" :tab="t('updates.bySkill')">
        <n-card :title="t('updates.plan')">
          <n-space vertical size="large">
            <n-checkbox-group v-if="state?.candidates?.length" v-model:value="selected">
              <n-space wrap>
                <n-checkbox v-for="candidate in state?.candidates" :key="candidate.skill" :value="candidate.skill">
                  {{ candidate.skill }}
                </n-checkbox>
              </n-space>
            </n-checkbox-group>
            <n-empty v-else :description="t('updates.noCandidates')" />
            <n-button type="primary" :disabled="!selected.length" @click="updateSkills">{{ t('common.update') }}</n-button>
            <UpdatePlan :candidates="state?.candidates || []" />
          </n-space>
        </n-card>
      </n-tab-pane>

      <n-tab-pane name="source" :tab="t('updates.bySource')">
        <n-grid :cols="3" :x-gap="16" :y-gap="16" responsive="screen">
          <n-gi v-for="source in state?.sources" :key="source.key">
            <n-card :title="source.url" size="small">
              <n-space vertical>
                <n-text depth="3">{{ source.skills.map((candidate) => candidate.skill).join(', ') }}</n-text>
                <n-button type="primary" @click="updateSource(source.key)">{{ t('common.update') }}</n-button>
              </n-space>
            </n-card>
          </n-gi>
        </n-grid>
        <n-empty v-if="!state?.sources?.length" :description="t('sources.noSources')" />
      </n-tab-pane>

      <n-tab-pane name="url" :tab="t('updates.fromUrl')">
        <DiscoverWizard />
      </n-tab-pane>
    </n-tabs>
    <n-alert type="info" :show-icon="false">{{ t('common.gitDiffNext') }}</n-alert>
    <LogPanel />
  </n-space>
</template>
