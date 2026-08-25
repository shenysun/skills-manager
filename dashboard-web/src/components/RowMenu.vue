<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineEmits<{
  undistribute: [];
  remove: [];
}>();

const open = defineModel<boolean>({ default: false });

const { t } = useI18n();
</script>

<template>
  <span class="row-menu">
    <button class="more" @click="open = !open">⋮</button>
    <Teleport to="body">
      <div v-if="open" class="menu-backdrop" @click="open = false"></div>
    </Teleport>
    <div v-if="open" class="menu">
      <button
        @click="
          open = false;
          $emit('undistribute');
        "
      >
        {{ t('menu.undistribute') }}
      </button>
      <button
        @click="
          open = false;
          $emit('remove');
        "
      >
        {{ t('menu.remove') }}
      </button>
    </div>
  </span>
</template>
