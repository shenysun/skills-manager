<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { state } from '../composables/useApi';

const { t } = useI18n();
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('activity.title')" />
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
