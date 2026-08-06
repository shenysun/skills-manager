<script setup lang="ts">
import { computed, h } from 'vue';
import { useI18n } from 'vue-i18n';
import { NIcon, type MenuOption } from 'naive-ui';
import AppsOutline from '@vicons/ionicons5/es/AppsOutline';
import CompassOutline from '@vicons/ionicons5/es/CompassOutline';
import FileTrayFullOutline from '@vicons/ionicons5/es/FileTrayFullOutline';
import HomeOutline from '@vicons/ionicons5/es/HomeOutline';
import LibraryOutline from '@vicons/ionicons5/es/LibraryOutline';
import RefreshOutline from '@vicons/ionicons5/es/RefreshOutline';
import SettingsOutline from '@vicons/ionicons5/es/SettingsOutline';
import TimeOutline from '@vicons/ionicons5/es/TimeOutline';

defineProps<{ route: string }>();
const { t } = useI18n();
const nav = ['overview', 'installed', 'sources', 'discover', 'updates', 'registry', 'activity', 'settings'] as const;
const icons = {
  overview: HomeOutline,
  installed: AppsOutline,
  sources: LibraryOutline,
  discover: CompassOutline,
  updates: RefreshOutline,
  registry: FileTrayFullOutline,
  activity: TimeOutline,
  settings: SettingsOutline,
};
const menuOptions = computed<MenuOption[]>(() => nav.map((item) => ({
  key: item,
  icon: () => h(NIcon, null, { default: () => h(icons[item]) }),
  label: () => h('a', { href: `#/${item}` }, t(`nav.${item}`)),
})));
</script>

<template>
  <div class="sidebar-content">
    <n-space align="center" :size="12" class="brand-block">
      <n-avatar round color="#2563eb" size="large">SM</n-avatar>
      <div>
        <n-text strong>{{ t('app.title') }}</n-text>
        <div><n-text depth="3">{{ t('app.subtitle') }}</n-text></div>
      </div>
    </n-space>
    <n-menu :value="route" :options="menuOptions" />
  </div>
</template>
