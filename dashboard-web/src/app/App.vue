<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppShell from './AppShell.vue';
import OverviewPage from '../pages/OverviewPage.vue';
import InstalledPage from '../pages/InstalledPage.vue';
import SourcesPage from '../pages/SourcesPage.vue';
import DiscoverPage from '../pages/DiscoverPage.vue';
import UpdatesPage from '../pages/UpdatesPage.vue';
import RegistryPage from '../pages/RegistryPage.vue';
import ActivityPage from '../pages/ActivityPage.vue';
import SettingsPage from '../pages/SettingsPage.vue';
import { refreshState } from '../composables/useApi';
import { useTheme } from '../composables/useTheme';

useTheme();
const route = ref(location.hash.replace('#/', '') || 'overview');
window.addEventListener('hashchange', () => { route.value = location.hash.replace('#/', '') || 'overview'; });
onMounted(refreshState);
const page = computed(() => ({ overview: OverviewPage, installed: InstalledPage, sources: SourcesPage, discover: DiscoverPage, updates: UpdatesPage, registry: RegistryPage, activity: ActivityPage, settings: SettingsPage }[route.value] || OverviewPage));
</script>
<template><AppShell :route="route"><component :is="page" /></AppShell></template>
