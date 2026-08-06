<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { darkTheme, dateEnUS, dateZhCN, enUS, zhCN, type GlobalThemeOverrides } from 'naive-ui';
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
import { useLocale } from '../composables/useLocale';
import { useTheme } from '../composables/useTheme';

const { effectiveTheme } = useTheme();
const { locale } = useLocale();
const route = ref(location.hash.replace('#/', '') || 'overview');

window.addEventListener('hashchange', () => { route.value = location.hash.replace('#/', '') || 'overview'; });
onMounted(refreshState);

const page = computed(() => ({
  overview: OverviewPage,
  installed: InstalledPage,
  sources: SourcesPage,
  discover: DiscoverPage,
  updates: UpdatesPage,
  registry: RegistryPage,
  activity: ActivityPage,
  settings: SettingsPage,
}[route.value] || OverviewPage));

const naiveTheme = computed(() => (effectiveTheme.value === 'dark' ? darkTheme : null));
const naiveLocale = computed(() => (locale.value === 'zh-CN' ? zhCN : enUS));
const naiveDateLocale = computed(() => (locale.value === 'zh-CN' ? dateZhCN : dateEnUS));
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#2563EB',
    primaryColorHover: '#3B82F6',
    primaryColorPressed: '#1D4ED8',
    borderRadius: '12px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
};
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale" :date-locale="naiveDateLocale">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <AppShell :route="route">
            <component :is="page" />
          </AppShell>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
