<script setup lang="ts">
defineProps<{ consumers: string[] }>();
</script>

<template>
  <n-space v-if="consumers.length" :size="4" inline>
    <n-tag v-for="consumer in consumers" :key="consumer" size="small" round>{{ consumer }}</n-tag>
  </n-space>
  <n-text v-else depth="3">—</n-text>
</template>
