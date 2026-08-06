<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { state, refreshState } from '../composables/useApi';
import { useLocale } from '../composables/useLocale';
import { useTheme } from '../composables/useTheme';
const { t } = useI18n();
const { locale } = useLocale();
const { theme } = useTheme();
</script>
<template>
  <header class="topbar">
    <div><strong>{{ state?.skillHome || '—' }}</strong><span>{{ state?.package?.info?.name || '@shenysun/skills-manager' }}</span></div>
    <div class="toolbar">
      <label>{{ t('app.language') }} <select v-model="locale"><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
      <label>{{ t('app.theme') }} <select v-model="theme"><option value="system">{{ t('app.system') }}</option><option value="light">{{ t('app.light') }}</option><option value="dark">{{ t('app.dark') }}</option></select></label>
      <button @click="refreshState">{{ t('app.refresh') }}</button>
    </div>
  </header>
</template>
