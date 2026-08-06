<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, runApi, state } from '../composables/useApi';
type Discovered = { name: string; title: string; description: string; subpath: string };
const { t } = useI18n();
const source = ref(localStorage.getItem('skills-manager-last-source') || '');
if (source.value) localStorage.removeItem('skills-manager-last-source');
const discovered = ref<Discovered[]>([]);
const selected = ref<string[]>([]);
const consumers = ref<string[]>(['agents','claude']);
const confirmOverwrite = ref(false);
const existing = computed(() => new Set(state.value?.skills.map(s => s.name) || []));
async function discover() {
  const result = await runApi(() => api<{ discovered: Discovered[] }>('/api/discover', { method: 'POST', body: JSON.stringify({ source: source.value }) }));
  discovered.value = result.discovered; selected.value = [];
}
async function install() {
  await runApi(() => api('/api/install', { method: 'POST', body: JSON.stringify({ source: source.value, subpaths: selected.value, consumers: consumers.value, overwrite: confirmOverwrite.value }) }));
}
</script>
<template>
  <section class="card"><h2>{{ t('discover.stepSource') }}</h2><div class="toolbar"><input v-model="source" class="wide" :placeholder="t('discover.sourcePlaceholder')"/><button @click="discover">{{ t('common.run') }}</button></div></section>
  <section class="card"><h2>{{ t('discover.stepSkills') }}</h2><div class="table-wrap"><table><thead><tr><th></th><th>Skill</th><th>Path</th><th>Status</th></tr></thead><tbody><tr v-for="skill in discovered" :key="skill.subpath"><td><input v-model="selected" :value="skill.subpath" type="checkbox"></td><td><strong>{{ skill.name }}</strong><br><span class="muted">{{ skill.description }}</span></td><td><code>{{ skill.subpath }}</code></td><td><span v-if="existing.has(skill.name)" class="badge warn">Overwrite</span><span v-else class="badge ok">New</span></td></tr></tbody></table></div></section>
  <section class="card"><h2>{{ t('discover.stepConsumers') }}</h2><label><input v-model="consumers" value="agents" type="checkbox"> agents</label> <label><input v-model="consumers" value="claude" type="checkbox"> claude</label></section>
  <section class="card"><h2>{{ t('discover.stepReview') }}</h2><p>{{ t('discover.overwrite') }}</p><label><input v-model="confirmOverwrite" type="checkbox"> Explicitly allow overwriting existing skills in this selection</label><button class="primary" :disabled="!selected.length || !confirmOverwrite" @click="install">{{ t('common.install') }} {{ selected.length }}</button></section>
</template>
