<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
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
    <n-page-header :title="t('activity.title')">
      <template #subtitle>{{ t('activity.subtitle') }}</template>
    </n-page-header>

    <n-card :title="t('activity.workspace')" size="small">
      <n-grid :cols="3" :x-gap="16" :y-gap="16" responsive="screen">
        <n-gi>
          <n-text depth="3">{{ t('settings.home') }}</n-text>
          <n-code :code="state?.skillHome || '—'" word-wrap />
        </n-gi>
        <n-gi>
          <n-text depth="3">{{ t('settings.package') }}</n-text>
          <div><n-tag round>{{ state?.package?.info?.name || '@shenysun/skills-manager' }}</n-tag></div>
        </n-gi>
        <n-gi>
          <n-text depth="3">{{ t('settings.pack') }}</n-text>
          <div><n-button type="primary" secondary :loading="packing" @click="pack">{{ t('settings.pack') }}</n-button></div>
        </n-gi>
      </n-grid>
    </n-card>

    <n-grid :cols="2" :x-gap="18" :y-gap="18" responsive="screen">
      <n-gi>
        <n-card :title="t('activity.operations')">
          <n-timeline v-if="state?.activity?.length">
            <n-timeline-item v-for="activity in state?.activity" :key="activity.id || activity.timestamp" type="info" :time="activity.timestamp" :title="activity.action || activity.summary">
              {{ activity.summary }}
            </n-timeline-item>
          </n-timeline>
          <n-empty v-else :description="t('activity.noOperations')" />
        </n-card>
      </n-gi>
      <n-gi>
        <n-card :title="t('activity.git')">
          <n-list v-if="state?.gitHistory?.length" hoverable>
            <n-list-item v-for="git in state?.gitHistory" :key="git.hash || git.timestamp">
              <n-thing :title="git.subject" :description="git.timestamp">
                <template #header-extra>
                  <n-tag v-if="git.hash" size="small" round>{{ git.hash.slice(0, 7) }}</n-tag>
                </template>
              </n-thing>
            </n-list-item>
          </n-list>
          <n-empty v-else :description="t('activity.noGitHistory')" />
        </n-card>
      </n-gi>
    </n-grid>
  </n-space>
</template>
