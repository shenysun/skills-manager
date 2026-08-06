<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { logText } from '../composables/useApi';

const { t } = useI18n();
const displayLog = computed(() => logText.value || t('common.ready'));
</script>

<template>
  <n-card :title="t('common.log')" size="small">
    <n-log :log="displayLog" language="json" trim class="log" />
  </n-card>
</template>
