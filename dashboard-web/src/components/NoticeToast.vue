<script setup lang="ts">
import { ToastDescription, ToastRoot, ToastViewport } from 'reka-ui';
import { DEFAULT_NOTICE_TTL_MS, type Notice } from '../domain/noticeSlot';

defineProps<{ notice: Notice | null; raised?: boolean }>();
</script>

<template>
  <!-- One ToastRoot only — a new notice remounts this slot instead of stacking. -->
  <ToastRoot
    v-if="notice"
    :key="`${notice.kind}:${notice.text}`"
    :open="true"
    :duration="DEFAULT_NOTICE_TTL_MS"
    type="foreground"
    as="div"
    role="status"
    aria-live="polite"
    class="max-w-[min(560px,calc(100vw-48px))] rounded-[8px] border border-line bg-bg px-[14px] py-[8px] text-center text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
    :class="notice.kind === 'error' ? 'text-danger' : 'text-ok'"
  >
    <ToastDescription>{{ notice.text }}</ToastDescription>
  </ToastRoot>
  <ToastViewport
    as="div"
    class="fixed left-1/2 z-[650] flex -translate-x-1/2 p-0"
    :class="raised ? 'bottom-[84px]' : 'bottom-[24px]'"
    :label="''"
  />
</template>
