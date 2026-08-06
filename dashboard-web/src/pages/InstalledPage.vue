<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SkillTable from '../components/SkillTable.vue';
import SkillDrawer from '../components/SkillDrawer.vue';
import LogPanel from '../components/LogPanel.vue';
import { api, state, type Skill } from '../composables/useApi';
import { useOperationNotification } from '../composables/useOperationNotification';

const { t } = useI18n();
const { runWithNotification } = useOperationNotification();
const search = ref('');
const consumer = ref<string | null>(null);
const selected = ref<string[]>([]);
const openSkill = ref<Skill | null>(null);
const busyAction = ref('');
const consumerOptions = computed(() => [{ label: t('common.all'), value: '' }, { label: 'agents', value: 'agents' }, { label: 'claude', value: 'claude' }]);

const skills = computed(() => (state.value?.skills || []).filter((skill) => {
  const selectedConsumer = consumer.value || '';
  return (!selectedConsumer || skill.consumers.includes(selectedConsumer))
    && (!search.value || JSON.stringify(skill).toLowerCase().includes(search.value.toLowerCase()));
}));

function toggle(name: string) {
  selected.value = selected.value.includes(name) ? selected.value.filter((skill) => skill !== name) : [...selected.value, name];
}

async function runSkillAction<T>(action: string, loading: string, success: string, fn: () => Promise<T>) {
  busyAction.value = action;
  try {
    return await runWithNotification(fn, { loading, success, error: t('notification.failed') });
  } finally {
    busyAction.value = '';
  }
}

const updateSelected = () => runSkillAction('update-selected', t('loading.updatingSelected'), t('notification.updateDone'), () => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills: selected.value }) }));
const updateOne = (skill: string) => runSkillAction(`update-${skill}`, t('loading.updatingSkill', { skill }), t('notification.updateDone'), () => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills: [skill] }) }));
const expose = (consumerName: string, only?: string) => runSkillAction(`expose-${consumerName}`, t('loading.exposing'), t('notification.exposeDone'), () => api('/api/skills/expose', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value, consumer: consumerName }) }));
const hide = (consumerName: string, only?: string) => runSkillAction(`hide-${consumerName}`, t('loading.hiding'), t('notification.hideDone'), () => api('/api/skills/hide', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value, consumer: consumerName }) }));
const archive = (only?: string) => runSkillAction('archive', t('loading.archiving'), t('notification.archiveDone'), () => api('/api/skills/archive', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value }) }));
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
          <n-button :disabled="!selected.length" :loading="busyAction === 'update-selected'" @click="updateSelected">{{ t('installed.updateSelected') }}</n-button>
          <n-button :disabled="!selected.length" :loading="busyAction === 'expose-agents'" @click="expose('agents')">{{ t('installed.exposeConsumer', { consumer: 'agents' }) }}</n-button>
          <n-button :disabled="!selected.length" :loading="busyAction === 'expose-claude'" @click="expose('claude')">{{ t('installed.exposeConsumer', { consumer: 'claude' }) }}</n-button>
          <n-button :disabled="!selected.length" :loading="busyAction === 'hide-agents'" tertiary @click="hide('agents')">{{ t('installed.hideConsumer', { consumer: 'agents' }) }}</n-button>
          <n-button :disabled="!selected.length" :loading="busyAction === 'hide-claude'" tertiary @click="hide('claude')">{{ t('installed.hideConsumer', { consumer: 'claude' }) }}</n-button>
          <n-button :disabled="!selected.length" :loading="busyAction === 'archive'" type="error" secondary @click="archive()">{{ t('installed.archiveSelected') }}</n-button>
        </n-space>
        <n-alert type="info" :show-icon="false">{{ t('installed.noDelete') }}</n-alert>
        <SkillTable :skills="skills" :selected="selected" @toggle="toggle" @open="openSkill = $event" />
      </n-space>
    </n-card>

    <SkillDrawer :busy-action="busyAction" :skill="openSkill" @close="openSkill = null" @update="updateOne" @expose="(skill, selectedConsumer) => expose(selectedConsumer, skill)" @hide="(skill, selectedConsumer) => hide(selectedConsumer, skill)" @archive="archive" />
    <LogPanel />
  </n-space>
</template>
