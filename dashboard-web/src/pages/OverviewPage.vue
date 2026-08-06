<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import LogPanel from '../components/LogPanel.vue';
import { api, runApi, state } from '../composables/useApi';
const { t } = useI18n();
const runDoctor = () => runApi(() => api('/api/doctor'));
</script>
<template>
  <section class="page-head"><h1>{{ t('overview.title') }}</h1><button @click="runDoctor">{{ t('overview.runDoctor') }}</button></section>
  <section class="metrics"><article class="metric"><span>{{ t('overview.skills') }}</span><strong>{{ state?.counts?.skills || 0 }}</strong></article><article class="metric"><span>{{ t('overview.sources') }}</span><strong>{{ state?.counts?.sources || 0 }}</strong></article><article class="metric"><span>{{ t('overview.agents') }}</span><strong>{{ state?.counts?.agents || 0 }}</strong></article><article class="metric"><span>{{ t('overview.claude') }}</span><strong>{{ state?.counts?.claude || 0 }}</strong></article></section>
  <section class="grid two"><article class="card"><h2>{{ t('overview.health') }} <StatusBadge :ok="!(state?.doctor?.warnings?.length || state?.doctor?.brokenLinks?.length)" /></h2><h3>{{ t('overview.warnings') }}</h3><EmptyState v-if="!state?.doctor?.warnings?.length" title="No warnings"/><ul><li v-for="w in state?.doctor?.warnings" :key="w">{{ w }}</li></ul><h3>{{ t('overview.broken') }}</h3><ul><li v-for="b in state?.doctor?.brokenLinks" :key="b"><code>{{ b }}</code></li></ul></article><article class="card"><h2>{{ t('overview.git') }}</h2><pre class="log">{{ state?.doctor?.gitStatus || 'clean' }}</pre><h2>{{ t('overview.recent') }}</h2><ul><li v-for="a in state?.activity?.slice(0,5)" :key="a.id">{{ a.timestamp }} — {{ a.summary }}</li></ul></article></section><LogPanel />
</template>
