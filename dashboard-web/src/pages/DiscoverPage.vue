<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DiscoverWizard from '../components/DiscoverWizard.vue';
import LogPanel from '../components/LogPanel.vue';

const { t } = useI18n();
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('discover.title')" />
    <DiscoverWizard />
    <LogPanel />
  </n-space>
</template>
