<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { currentOperationLabel, isBusy, refreshState, state } from '../composables/useApi';
import { useLocale } from '../composables/useLocale';
import { useTheme } from '../composables/useTheme';

const { t } = useI18n();
const { locale } = useLocale();
const { theme } = useTheme();
const localeOptions = [{ label: '中文', value: 'zh-CN' }, { label: 'English', value: 'en-US' }];
const themeOptions = computed(() => [
  { label: t('app.system'), value: 'system' },
  { label: t('app.light'), value: 'light' },
  { label: t('app.dark'), value: 'dark' },
]);
const refresh = () => refreshState({ label: t('loading.refreshing') });
</script>

<template>
  <div class="topbar">
    <div class="topbar-title">
      <n-text strong>{{ state?.skillHome || '—' }}</n-text>
      <n-text depth="3">{{ state?.package?.info?.name || '@shenysun/skills-manager' }}</n-text>
    </div>
    <n-space align="center" wrap>
      <n-tag v-if="isBusy" type="info" round class="operation-status">
        <n-space :size="6" align="center" inline>
          <n-spin size="small" />
          <span>{{ currentOperationLabel || t('loading.working') }}</span>
        </n-space>
      </n-tag>
      <n-select v-model:value="locale" :options="localeOptions" :aria-label="t('app.language')" style="width: 132px" />
      <n-select v-model:value="theme" :options="themeOptions" :aria-label="t('app.theme')" style="width: 132px" />
      <n-button type="primary" :loading="isBusy" @click="refresh">{{ t('app.refresh') }}</n-button>
    </n-space>
  </div>
</template>
