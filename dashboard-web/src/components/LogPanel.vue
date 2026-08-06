<script setup lang="ts">
import { logText } from '../composables/useApi';
</script>

<template>
  <n-card title="Log" size="small">
    <n-log :log="logText" language="json" trim class="log" />
  </n-card>
</template>
