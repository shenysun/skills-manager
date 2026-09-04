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
    <div
      class="fixed bottom-[24px] left-1/2 z-[400] flex -translate-x-1/2 items-center gap-[14px] rounded-[12px] bg-fg px-[16px] py-[10px] text-[14px] text-bg shadow-[0_12px_32px_rgba(0,0,0,0.25)]"
    >
      <span class="font-semibold">{{ t('selection.count', count) }}</span>
      <button class="rounded-[7px] px-[12px] py-[5px] hover:enabled:bg-fg3/25 disabled:cursor-default disabled:opacity-50" :disabled="busy" @click="$emit('update')">
        {{ t('action.update') }}
      </button>
      <button class="rounded-[7px] px-[12px] py-[5px] hover:enabled:bg-fg3/25 disabled:cursor-default disabled:opacity-50" :disabled="busy" @click="$emit('distribute')">
        {{ t('action.distribute') }}
      </button>
      <button class="rounded-[7px] px-[12px] py-[5px] text-danger hover:enabled:bg-fg3/25 disabled:cursor-default disabled:opacity-50" :disabled="busy" @click="$emit('remove')">
        {{ t('menu.removeTitle') }}
      </button>
      <button class="rounded-[7px] px-[12px] py-[5px] hover:bg-fg3/25" @click="$emit('cancel')">
        {{ t('selection.cancel') }}
      </button>
      <span class="text-[12px] opacity-60">{{ t('selection.esc') }}</span>
    </div>
  </Teleport>
</template>
