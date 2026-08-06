<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SkillTable from '../components/SkillTable.vue';
import SkillDrawer from '../components/SkillDrawer.vue';
import LogPanel from '../components/LogPanel.vue';
import { api, runApi, state, type Skill } from '../composables/useApi';

const { t } = useI18n();
const search = ref('');
const consumer = ref<string | null>(null);
const selected = ref<string[]>([]);
const openSkill = ref<Skill | null>(null);
const consumerOptions = computed(() => [{ label: t('common.all'), value: '' }, { label: 'agents', value: 'agents' }, { label: 'claude', value: 'claude' }]);

const skills = computed(() => (state.value?.skills || []).filter((skill) => {
  const selectedConsumer = consumer.value || '';
  return (!selectedConsumer || skill.consumers.includes(selectedConsumer))
    && (!search.value || JSON.stringify(skill).toLowerCase().includes(search.value.toLowerCase()));
}));

function toggle(name: string) {
  selected.value = selected.value.includes(name) ? selected.value.filter((skill) => skill !== name) : [...selected.value, name];
}

const updateSelected = () => runApi(() => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills: selected.value }) }));
const updateOne = (skill: string) => runApi(() => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills: [skill] }) }));
const expose = (consumerName: string, only?: string) => runApi(() => api('/api/skills/expose', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value, consumer: consumerName }) }));
const hide = (consumerName: string, only?: string) => runApi(() => api('/api/skills/hide', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value, consumer: consumerName }) }));
const archive = (only?: string) => runApi(() => api('/api/skills/archive', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value }) }));
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('installed.title')">
      <template #extra>
        <n-tag type="info" round>{{ selected.length }} {{ t('common.selected') }}</n-tag>
      </template>
    </n-page-header>

    <n-card>
      <n-space vertical size="large">
        <n-space align="center" wrap>
          <n-input v-model:value="search" clearable :placeholder="t('installed.filter')" style="min-width: 280px" />
          <n-select v-model:value="consumer" :options="consumerOptions" clearable style="width: 140px" />
          <n-button :disabled="!selected.length" @click="updateSelected">{{ t('installed.updateSelected') }}</n-button>
          <n-button :disabled="!selected.length" @click="expose('agents')">{{ t('installed.exposeConsumer', { consumer: 'agents' }) }}</n-button>
          <n-button :disabled="!selected.length" @click="expose('claude')">{{ t('installed.exposeConsumer', { consumer: 'claude' }) }}</n-button>
          <n-button :disabled="!selected.length" tertiary @click="hide('agents')">{{ t('installed.hideConsumer', { consumer: 'agents' }) }}</n-button>
          <n-button :disabled="!selected.length" tertiary @click="hide('claude')">{{ t('installed.hideConsumer', { consumer: 'claude' }) }}</n-button>
          <n-button :disabled="!selected.length" type="error" secondary @click="archive()">{{ t('installed.archiveSelected') }}</n-button>
        </n-space>
        <n-alert type="info" :show-icon="false">{{ t('installed.noDelete') }}</n-alert>
        <SkillTable :skills="skills" :selected="selected" @toggle="toggle" @open="openSkill = $event" />
      </n-space>
    </n-card>

    <SkillDrawer :skill="openSkill" @close="openSkill = null" @update="updateOne" @expose="(skill, selectedConsumer) => expose(selectedConsumer, skill)" @hide="(skill, selectedConsumer) => hide(selectedConsumer, skill)" @archive="archive" />
    <LogPanel />
  </n-space>
</template>
