<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import { api, state, type ActivityRecord } from '../composables/useApi';
import { useOperationNotification } from '../composables/useOperationNotification';

const { t, locale } = useI18n();
const { runWithNotification } = useOperationNotification();
const doctorLoading = ref(false);
async function runDoctor() {
  doctorLoading.value = true;
  try {
    await runWithNotification(() => api('/api/doctor'), { loading: t('loading.runningDoctor'), success: t('notification.doctorDone'), error: t('notification.failed') });
  } finally {
    doctorLoading.value = false;
  }
}

const healthy = computed(() => !(state.value?.doctor?.warnings?.length || state.value?.doctor?.brokenLinks?.length));
const recentActivities = computed(() => (state.value?.activity || []).slice(0, 6));

function formatActivityTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp || '—';
  return new Intl.DateTimeFormat(String(locale.value), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function activityTitle(activity: ActivityRecord) {
  return activity.summary || activity.subject || activity.action || t('activity.operations');
}

function activityMeta(activity: ActivityRecord) {
  const parts = [activity.action, activity.hash ? activity.hash.slice(0, 7) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('overview.activityRecord');
}
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('overview.title')">
      <template #extra>
        <n-button type="primary" :loading="doctorLoading" @click="runDoctor">{{ t('overview.runDoctor') }}</n-button>
      </template>
    </n-page-header>

    <n-grid :cols="5" :x-gap="14" :y-gap="14" responsive="screen">
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
      <n-gi>
        <n-card><n-statistic :label="t('overview.outdated')" :value="state?.counts?.outdated || 0" /></n-card>
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
        <n-card class="recent-card">
          <template #header>
            <n-space align="center" justify="space-between" class="recent-header">
              <div class="action-center-copy">
                <n-text strong>{{ t('overview.recent') }}</n-text>
                <n-text depth="3">{{ t('overview.recentHint') }}</n-text>
              </div>
              <n-button text tag="a" href="#/activity">{{ t('overview.viewAllActivity') }}</n-button>
            </n-space>
          </template>

          <div v-if="recentActivities.length" class="recent-list">
            <article v-for="activity in recentActivities" :key="activity.id || activity.timestamp" class="recent-item">
              <time class="recent-time">{{ formatActivityTime(activity.timestamp) }}</time>
              <div class="recent-dot" aria-hidden="true" />
              <div class="recent-main">
                <div class="recent-title-row">
                  <n-text strong>{{ activityTitle(activity) }}</n-text>
                  <n-tag size="small" round>{{ activityMeta(activity) }}</n-tag>
                </div>
                <n-text v-if="activity.details" depth="3" class="recent-detail">
                  {{ t('overview.hasDetails') }}
                </n-text>
              </div>
            </article>
          </div>
          <EmptyState v-else :title="t('overview.noRecent')" />
        </n-card>
      </n-gi>
    </n-grid>
  </n-space>
</template>
