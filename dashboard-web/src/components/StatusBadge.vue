<script setup lang="ts">
defineProps<{ ok?: boolean; label?: string }>();
</script>

<template>
  <n-tag :type="ok ? 'success' : 'warning'" round size="small">
    {{ label || (ok ? 'OK' : 'Check') }}
  </n-tag>
</template>
