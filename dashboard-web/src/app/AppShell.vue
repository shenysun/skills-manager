<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import Topbar from './Topbar.vue';

defineProps<{ route: string }>();
</script>

<template>
  <n-layout class="shell" has-sider>
    <n-layout-sider bordered collapse-mode="width" :collapsed-width="0" :width="270" show-trigger="bar">
      <Sidebar :route="route" />
    </n-layout-sider>
    <n-layout class="workspace">
      <n-layout-header bordered class="topbar-wrap">
        <Topbar />
      </n-layout-header>
      <n-layout-content class="page">
        <slot />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>
