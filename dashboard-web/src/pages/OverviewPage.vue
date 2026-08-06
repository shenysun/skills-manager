<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import LogPanel from '../components/LogPanel.vue';
import { api, runApi, state } from '../composables/useApi';

const { t } = useI18n();
const runDoctor = () => runApi(() => api('/api/doctor'));
const healthy = computed(() => !(state.value?.doctor?.warnings?.length || state.value?.doctor?.brokenLinks?.length));
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('overview.title')">
      <template #extra>
        <n-button type="primary" @click="runDoctor">{{ t('overview.runDoctor') }}</n-button>
      </template>
    </n-page-header>

    <n-grid :cols="4" :x-gap="14" :y-gap="14" responsive="screen">
      <n-gi>
        <n-card><n-statistic :label="t('overview.skills')" :value="state?.counts?.skills || 0" /></n-card>
      </n-gi>
      <n-gi>
        <n-card><n-statistic :label="t('overview.sources')" :value="state?.counts?.sources || 0" /></n-card>
      </n-gi>
      <n-gi>
        <n-card><n-statistic :label="t('overview.agents')" :value="state?.counts?.agents || 0" /></n-card>
      </n-gi>
      <n-gi>
        <n-card><n-statistic :label="t('overview.claude')" :value="state?.counts?.claude || 0" /></n-card>
      </n-gi>
    </n-grid>

    <n-grid :cols="2" :x-gap="18" :y-gap="18" responsive="screen">
      <n-gi>
        <n-card>
          <template #header>
            <n-space align="center">
              <span>{{ t('overview.health') }}</span>
              <StatusBadge :ok="healthy" />
            </n-space>
          </template>
          <n-space vertical size="large">
            <section>
              <n-h3>{{ t('overview.warnings') }}</n-h3>
              <EmptyState v-if="!state?.doctor?.warnings?.length" :title="t('overview.noWarnings')" />
              <n-list v-else bordered>
                <n-list-item v-for="warning in state?.doctor?.warnings" :key="warning">
                  <n-alert type="warning">{{ warning }}</n-alert>
                </n-list-item>
              </n-list>
            </section>
            <section>
              <n-h3>{{ t('overview.broken') }}</n-h3>
              <EmptyState v-if="!state?.doctor?.brokenLinks?.length" :title="t('overview.noBroken')" />
              <n-list v-else bordered>
                <n-list-item v-for="link in state?.doctor?.brokenLinks" :key="link">
                  <n-code :code="link" word-wrap />
                </n-list-item>
              </n-list>
            </section>
          </n-space>
        </n-card>
      </n-gi>
      <n-gi>
        <n-card :title="t('overview.git')">
          <n-space vertical size="large">
            <n-log :log="state?.doctor?.gitStatus || t('common.clean')" trim />
            <section>
              <n-h3>{{ t('overview.recent') }}</n-h3>
              <n-list v-if="state?.activity?.length" hoverable>
                <n-list-item v-for="activity in state?.activity?.slice(0, 5)" :key="activity.id || activity.timestamp">
                  <n-thing :title="activity.summary" :description="activity.timestamp" />
                </n-list-item>
              </n-list>
              <EmptyState v-else :title="t('overview.noRecent')" />
            </section>
          </n-space>
        </n-card>
      </n-gi>
    </n-grid>

    <LogPanel />
  </n-space>
</template>
