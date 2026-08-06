<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import Topbar from './Topbar.vue';

defineProps<{ route: string }>();
</script>

<template>
  <div class="shell">
    <n-layout-sider bordered collapse-mode="width" :collapsed-width="0" :width="270" show-trigger="bar">
      <Sidebar :route="route" />
    </n-layout-sider>
    <div class="workspace">
      <n-layout-header bordered class="topbar-wrap">
        <Topbar />
      </n-layout-header>
      <main class="content-host">
        <div class="page">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
