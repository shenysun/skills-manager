<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ count: number; busy?: boolean }>();
defineEmits<{
  update: [];
  distribute: [];
  remove: [];
  cancel: [];
}>();

const { t } = useI18n();
</script>

<template>
  <Teleport to="body">
    <div class="selection-bar">
      <span class="count">{{ t('selection.count', count) }}</span>
      <button class="act" :disabled="busy" @click="$emit('update')">{{ t('action.update') }}</button>
      <button class="act" :disabled="busy" @click="$emit('distribute')">{{ t('action.distribute') }}</button>
      <button class="act remove" :disabled="busy" @click="$emit('remove')">{{ t('menu.removeTitle') }}</button>
      <button class="act" @click="$emit('cancel')">{{ t('selection.cancel') }}</button>
      <span class="esc">{{ t('selection.esc') }}</span>
    </div>
  </Teleport>
</template>
