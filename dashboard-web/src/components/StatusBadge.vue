<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ ok?: boolean; label?: string }>();

const { t } = useI18n();
</script>

<template>
  <n-tag :type="ok ? 'success' : 'warning'" round size="small">
    {{ label || (ok ? t('common.ok') : t('common.check')) }}
  </n-tag>
</template>
