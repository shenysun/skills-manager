<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { isBusy, refreshState, state } from '../composables/useApi';
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
const refreshLoading = ref(false);
async function refresh() {
  refreshLoading.value = true;
  try {
    await refreshState({ label: t('loading.refreshing') });
  } finally {
    refreshLoading.value = false;
  }
}
</script>

<template>
  <div class="topbar">
    <div class="topbar-title">
      <n-text strong>{{ state?.skillHome || '—' }}</n-text>
      <n-text depth="3">{{ state?.package?.info?.name || '@shenysun/skills-manager' }}</n-text>
    </div>
    <n-space align="center" wrap>
      <n-select v-model:value="locale" :options="localeOptions" :aria-label="t('app.language')" style="width: 132px" />
      <n-select v-model:value="theme" :options="themeOptions" :aria-label="t('app.theme')" style="width: 132px" />
      <n-button type="primary" :loading="refreshLoading" @click="refresh">{{ t('app.refresh') }}</n-button>
    </n-space>
    <div v-if="isBusy" class="operation-bar" role="status" :aria-label="t('loading.working')">
      <span class="operation-bar__track"><span /></span>
    </div>
  </div>
</template>
