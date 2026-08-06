<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SkillTable from '../components/SkillTable.vue';
import SkillDrawer from '../components/SkillDrawer.vue';
import LogPanel from '../components/LogPanel.vue';
import { api, runApi, state, type Skill } from '../composables/useApi';
const { t } = useI18n();
const search = ref(''); const consumer = ref(''); const selected = ref<string[]>([]); const openSkill = ref<Skill|null>(null);
const skills = computed(() => (state.value?.skills || []).filter(s => (!consumer.value || s.consumers.includes(consumer.value)) && (!search.value || JSON.stringify(s).toLowerCase().includes(search.value.toLowerCase()))));
function toggle(name: string) { selected.value = selected.value.includes(name) ? selected.value.filter(s => s !== name) : [...selected.value, name]; }
const updateSelected = () => runApi(() => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills: selected.value }) }));
const updateOne = (skill: string) => runApi(() => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills: [skill] }) }));
const expose = (c: string, only?: string) => runApi(() => api('/api/skills/expose', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value, consumer: c }) }));
const hide = (c: string, only?: string) => runApi(() => api('/api/skills/hide', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value, consumer: c }) }));
const archive = (only?: string) => runApi(() => api('/api/skills/archive', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value }) }));
</script>
<template><section class="page-head"><h1>{{ t('installed.title') }}</h1><span>{{ selected.length }} {{ t('common.selected') }}</span></section><section class="card"><div class="toolbar"><input v-model="search" :placeholder="t('installed.filter')"><select v-model="consumer"><option value="">All</option><option>agents</option><option>claude</option></select><button :disabled="!selected.length" @click="updateSelected">{{ t('installed.updateSelected') }}</button><button :disabled="!selected.length" @click="expose('agents')">{{ t('common.expose') }} agents</button><button :disabled="!selected.length" @click="expose('claude')">{{ t('common.expose') }} claude</button><button :disabled="!selected.length" @click="hide('agents')">{{ t('common.hide') }} agents</button><button :disabled="!selected.length" @click="hide('claude')">{{ t('common.hide') }} claude</button><button :disabled="!selected.length" class="danger" @click="archive()">{{ t('installed.archiveSelected') }}</button></div><p class="muted">{{ t('installed.noDelete') }}</p><SkillTable :skills="skills" :selected="selected" @toggle="toggle" @open="openSkill = $event" /></section><SkillDrawer :skill="openSkill" @close="openSkill = null" @update="updateOne" @expose="(skill, consumer) => expose(consumer, skill)" @hide="(skill, consumer) => hide(consumer, skill)" @archive="archive"/><LogPanel /></template>
