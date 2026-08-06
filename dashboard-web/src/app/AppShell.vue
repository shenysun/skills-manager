<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import Topbar from './Topbar.vue';
defineProps<{ route: string }>();
</script>
<template>
  <div class="shell">
    <Sidebar :route="route" />
    <div class="workspace">
      <Topbar />
      <main class="page"><slot /></main>
    </div>
  </div>
</template>
