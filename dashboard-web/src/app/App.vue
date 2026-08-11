<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { darkTheme, dateEnUS, dateZhCN, enUS, zhCN, type GlobalThemeOverrides } from 'naive-ui';
import AppShell from './AppShell.vue';
import OverviewPage from '../pages/OverviewPage.vue';
import InstalledPage from '../pages/InstalledPage.vue';
import SourcesPage from '../pages/SourcesPage.vue';
import RegistryPage from '../pages/RegistryPage.vue';
import ActivityPage from '../pages/ActivityPage.vue';
import { refreshState } from '../composables/useApi';
import { useLocale } from '../composables/useLocale';
import { useTheme } from '../composables/useTheme';
import { resolveDashboardHash, type DashboardSurface } from '../routing/resolveDashboardHash';

const { effectiveTheme } = useTheme();
const { locale } = useLocale();
const surface = ref<DashboardSurface>(resolveDashboardHash(location.hash).surface);

function syncRouteFromLocation() {
  const resolved = resolveDashboardHash(location.hash);
  if (resolved.redirectHash && resolved.redirectHash !== location.hash) {
    const target = resolved.redirectHash;
    if (location.hash !== target) {
      location.replace(`${location.pathname}${location.search}${target}`);
    }
    return;
  }
  surface.value = resolved.surface;
}

window.addEventListener('hashchange', syncRouteFromLocation);
onMounted(() => {
  syncRouteFromLocation();
  void refreshState();
});

const page = computed(() => ({
  overview: OverviewPage,
  installed: InstalledPage,
  sources: SourcesPage,
  registry: RegistryPage,
  activity: ActivityPage,
}[surface.value] || OverviewPage));

const naiveTheme = computed(() => (effectiveTheme.value === 'dark' ? darkTheme : null));
const naiveLocale = computed(() => (locale.value === 'zh-CN' ? zhCN : enUS));
const naiveDateLocale = computed(() => (locale.value === 'zh-CN' ? dateZhCN : dateEnUS));
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#2563EB',
    primaryColorHover: '#3B82F6',
    primaryColorPressed: '#1D4ED8',
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  Card: {
    borderRadius: '14px',
  },
  Menu: {
    itemHeight: '42px',
    itemBorderRadius: '10px',
  },
};
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale" :date-locale="naiveDateLocale">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <AppShell :route="surface">
            <component :is="page" :key="surface" />
          </AppShell>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
