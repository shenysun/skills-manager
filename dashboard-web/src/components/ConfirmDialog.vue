<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ open: boolean; title: string; body?: string }>();
defineEmits<{ confirm: []; cancel: [] }>();

const { t } = useI18n();
</script>

<template>
  <n-modal :show="open" preset="dialog" :title="title" :positive-text="t('common.ok')" :negative-text="t('common.cancel')" @positive-click="$emit('confirm')" @negative-click="$emit('cancel')" @close="$emit('cancel')">
    {{ body }}
  </n-modal>
</template>
