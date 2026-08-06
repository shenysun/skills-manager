<script setup lang="ts">
defineProps<{ title: string; body?: string }>();
</script>

<template>
  <n-empty :description="body || title">
    <template v-if="body" #extra>
      <n-text strong>{{ title }}</n-text>
    </template>
  </n-empty>
</template>
