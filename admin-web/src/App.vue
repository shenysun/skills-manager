<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t, locale } = useI18n();

type Skill = { name: string; category: string; consumers: string[]; description?: string; source?: { url?: string; subpath?: string; ref?: string } };
type Candidate = { skill: string; url: string; subpath: string; ref?: string };
type SourceGroup = { key: string; url: string; ref?: string; skills: Candidate[] };
type Discovered = { name: string; subpath: string; description?: string };

const skillHome = ref('');
const skills = ref<Skill[]>([]);
const candidates = ref<Candidate[]>([]);
const sources = ref<SourceGroup[]>([]);
const discovered = ref<Discovered[]>([]);
const sourceInput = ref('');
const search = ref('');
const consumerFilter = ref('');
const selectedSkills = ref<string[]>([]);
const selectedDiscovered = ref<string[]>([]);
const selectedConsumers = ref<string[]>(['agents', 'claude']);
const logText = ref(t('ready'));

function setLocale(value: string) { locale.value = value; localStorage.setItem('skills-admin-locale', value); }
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function log(value: unknown) { logText.value = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
async function safe(fn: () => Promise<void>) { try { await fn(); } catch (e) { log(t('error', { message: e instanceof Error ? e.message : String(e) })); } }

async function loadAll() { await safe(async () => { const data = await api<{ skillHome: string; skills: Skill[]; candidates: Candidate[]; sources: SourceGroup[] }>('/api/state'); skillHome.value = data.skillHome; skills.value = data.skills; candidates.value = data.candidates; sources.value = data.sources; log(t('refreshed')); }); }
const visibleSkills = computed(() => skills.value.filter((s) => (!consumerFilter.value || s.consumers.includes(consumerFilter.value)) && (!search.value || [s.name, s.category, s.source?.url, s.source?.subpath].join(' ').toLowerCase().includes(search.value.toLowerCase()))));
function toggleVisible(checked: boolean) { selectedSkills.value = checked ? visibleSkills.value.map((s) => s.name) : []; }
function toggleDiscovered(checked: boolean) { selectedDiscovered.value = checked ? discovered.value.map((s) => s.subpath) : []; }
async function doctor() { await safe(async () => log(await api('/api/doctor'))); }
async function updateSelected() { if (!selectedSkills.value.length) return log(t('chooseSkill')); if (!confirm(t('confirmUpdate', { count: selectedSkills.value.length }))) return; await safe(async () => { log(await api('/api/update-skills', { method: 'POST', body: JSON.stringify({ skills: selectedSkills.value }) })); await loadAll(); }); }
async function updateSource(key: string) { if (!confirm(t('confirmSource'))) return; await safe(async () => { log(await api('/api/update-source', { method: 'POST', body: JSON.stringify({ key }) })); await loadAll(); }); }
async function exposeSelected(consumer: string) { if (!selectedSkills.value.length) return log(t('chooseSkill')); await safe(async () => { log(await api('/api/expose', { method: 'POST', body: JSON.stringify({ skills: selectedSkills.value, consumer }) })); await loadAll(); }); }
async function hideSelected(consumer: string) { if (!selectedSkills.value.length) return log(t('chooseSkill')); await safe(async () => { log(await api('/api/hide', { method: 'POST', body: JSON.stringify({ skills: selectedSkills.value, consumer }) })); await loadAll(); }); }
async function discover() { if (!sourceInput.value.trim()) return log(t('inputSource')); await safe(async () => { const data = await api<{ discovered: Discovered[] }>('/api/discover', { method: 'POST', body: JSON.stringify({ source: sourceInput.value.trim() }) }); discovered.value = data.discovered; selectedDiscovered.value = []; log(t('discovered', { count: data.discovered.length })); }); }
async function installDiscovered() { if (!sourceInput.value.trim() || !selectedDiscovered.value.length) return log(t('chooseSourceSkill')); if (!confirm(t('confirmInstall', { count: selectedDiscovered.value.length }))) return; await safe(async () => { log(await api('/api/install-source', { method: 'POST', body: JSON.stringify({ source: sourceInput.value.trim(), subpaths: selectedDiscovered.value, consumers: selectedConsumers.value }) })); await loadAll(); }); }

onMounted(loadAll);
</script>

<template>
  <header>
    <div><h1>{{ t('title') }}</h1><div class="muted">{{ skillHome }}</div></div>
    <div class="row"><label>{{ t('language') }} <select :value="locale" @change="setLocale(($event.target as HTMLSelectElement).value)"><option value="zh">中文</option><option value="en">English</option></select></label><button @click="loadAll">{{ t('refresh') }}</button><button @click="doctor">{{ t('doctor') }}</button></div>
  </header>
  <main>
    <section class="grid">
      <div class="card">
        <div class="row"><h2>{{ t('installed') }}</h2><span class="pill">{{ visibleSkills.length }}</span><span class="spacer"></span><input v-model="search" type="search" :placeholder="t('search')"/><select v-model="consumerFilter"><option value="">{{ t('allConsumers') }}</option><option>agents</option><option>claude</option></select></div>
        <div class="scroll"><table><thead><tr><th><input type="checkbox" @change="toggleVisible(($event.target as HTMLInputElement).checked)"></th><th>{{ t('skill') }}</th><th>{{ t('category') }}</th><th>{{ t('consumers') }}</th><th>{{ t('source') }}</th></tr></thead><tbody><tr v-for="s in visibleSkills" :key="s.name"><td><input v-model="selectedSkills" :value="s.name" type="checkbox"></td><td><b>{{ s.name }}</b><br><span class="muted">{{ s.description }}</span></td><td>{{ s.category }}</td><td><span v-for="c in s.consumers" :key="c" class="pill">{{ c }}</span></td><td><span class="muted">{{ s.source?.url || '-' }}</span><br><code>{{ s.source?.subpath }}</code></td></tr></tbody></table></div>
        <div class="row footer"><button class="ok" @click="updateSelected">{{ t('updateSelected') }}</button><button @click="exposeSelected('agents')">{{ t('expose') }} agents</button><button @click="exposeSelected('claude')">{{ t('expose') }} claude</button><button @click="hideSelected('agents')">{{ t('hide') }} agents</button><button @click="hideSelected('claude')">{{ t('hide') }} claude</button></div>
      </div>
      <div class="card"><h2>{{ t('updateBySource') }}</h2><p class="muted">{{ t('updateBySourceHint') }}</p><div class="scroll small"><table><thead><tr><th>{{ t('source') }}</th><th>{{ t('count') }}</th><th>{{ t('action') }}</th></tr></thead><tbody><tr v-for="g in sources" :key="g.key"><td><b>{{ g.url }}</b><br><span v-if="g.ref" class="pill">{{ g.ref }}</span><br><span class="muted">{{ g.skills.map(s => s.skill).join(', ') }}</span></td><td>{{ g.skills.length }}</td><td><button @click="updateSource(g.key)">{{ t('update') }}</button></td></tr></tbody></table></div><h2>{{ t('logs') }}</h2><pre class="log">{{ logText }}</pre></div>
    </section>
    <section class="card"><h2>{{ t('discoverInstall') }}</h2><div class="row"><input v-model="sourceInput" class="source-input" :placeholder="t('sourcePlaceholder')"><button class="primary" @click="discover">{{ t('discover') }}</button><button class="ok" @click="installDiscovered">{{ t('installSelected') }}</button></div><div class="row checks"><label v-for="c in ['agents','claude']" :key="c"><input v-model="selectedConsumers" :value="c" type="checkbox"> {{ c }}</label></div><div class="scroll"><table><thead><tr><th><input type="checkbox" @change="toggleDiscovered(($event.target as HTMLInputElement).checked)"></th><th>{{ t('skill') }}</th><th>{{ t('path') }}</th><th>{{ t('description') }}</th></tr></thead><tbody><tr v-for="s in discovered" :key="s.subpath"><td><input v-model="selectedDiscovered" :value="s.subpath" type="checkbox"></td><td>{{ s.name }}</td><td><code>{{ s.subpath }}</code></td><td>{{ s.description || '-' }}</td></tr></tbody></table></div></section>
    <section class="card"><h2>{{ t('registrySources') }}</h2><p class="muted">{{ t('registryHint') }}</p><div class="scroll small"><table><thead><tr><th>{{ t('skill') }}</th><th>{{ t('source') }}</th><th>{{ t('path') }}</th></tr></thead><tbody><tr v-for="c in candidates" :key="c.skill"><td>{{ c.skill }}</td><td>{{ c.ref ? `${c.url}#${c.ref}` : c.url }}</td><td><code>{{ c.subpath }}</code></td></tr></tbody></table></div></section>
  </main>
</template>
