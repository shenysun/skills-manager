<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import LogPanel from '../components/LogPanel.vue';
import { api, runApi, state } from '../composables/useApi';

const { t } = useI18n();
const pack = () => runApi(() => api('/api/package/dry-run', { method: 'POST', body: JSON.stringify({}) }));
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('settings.title')" />
    <n-grid :cols="2" :x-gap="18" :y-gap="18" responsive="screen">
      <n-gi>
        <n-card :title="t('settings.home')">
          <n-space vertical>
            <n-code :code="state?.skillHome || '—'" word-wrap />
            <n-alert type="info" :show-icon="false">{{ t('settings.docs') }}</n-alert>
          </n-space>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card :title="t('settings.package')">
          <n-space vertical>
            <n-code :code="JSON.stringify(state?.package, null, 2)" language="json" word-wrap />
            <n-button type="primary" @click="pack">{{ t('settings.pack') }}</n-button>
          </n-space>
        </n-card>
      </n-gi>
    </n-grid>
    <LogPanel />
  </n-space>
</template>
