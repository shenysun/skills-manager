<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import LogPanel from '../components/LogPanel.vue';
import { api, state } from '../composables/useApi';
import { useOperationNotification } from '../composables/useOperationNotification';

const { t } = useI18n();
const { runWithNotification } = useOperationNotification();
const packing = ref(false);
async function pack() {
  packing.value = true;
  try {
    await runWithNotification(() => api('/api/package/dry-run', { method: 'POST', body: JSON.stringify({}) }), { loading: t('loading.packing'), success: t('notification.packageDone'), error: t('notification.failed') });
  } finally {
    packing.value = false;
  }
}
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
            <n-button type="primary" :loading="packing" @click="pack">{{ t('settings.pack') }}</n-button>
          </n-space>
        </n-card>
      </n-gi>
    </n-grid>
    <LogPanel />
  </n-space>
</template>
