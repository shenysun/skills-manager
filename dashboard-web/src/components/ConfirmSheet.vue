<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';

defineProps<{ title: string; confirmLabel: string; danger?: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const { t } = useI18n();
</script>

<template>
  <Sheet :title="title" @cancel="emit('cancel')">
    <div class="confirm-body">
      <slot />
    </div>
    <div class="sheet-foot">
      <span></span>
      <button class="text-btn" @click="emit('cancel')">{{ t('remove.cancel') }}</button>
      <button class="primary-btn" :class="danger ? 'bg-danger' : ''" @click="emit('confirm')">{{ confirmLabel }}</button>
    </div>
  </Sheet>
</template>
