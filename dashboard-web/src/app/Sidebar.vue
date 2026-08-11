<script setup lang="ts">
import { computed, h } from 'vue';
import { useI18n } from 'vue-i18n';
import { NIcon, type MenuOption } from 'naive-ui';
import AppsOutline from '@vicons/ionicons5/es/AppsOutline';
import FileTrayFullOutline from '@vicons/ionicons5/es/FileTrayFullOutline';
import HomeOutline from '@vicons/ionicons5/es/HomeOutline';
import LibraryOutline from '@vicons/ionicons5/es/LibraryOutline';
import TimeOutline from '@vicons/ionicons5/es/TimeOutline';

const props = defineProps<{ route: string }>();
const { t } = useI18n();
const nav = ['overview', 'installed', 'sources', 'registry', 'activity'] as const;
const icons = {
  overview: HomeOutline,
  installed: AppsOutline,
  sources: LibraryOutline,
  registry: FileTrayFullOutline,
  activity: TimeOutline,
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
      <div class="brand-copy">
        <n-text strong>{{ t('app.title') }}</n-text>
        <div><n-text depth="3">{{ t('app.subtitle') }}</n-text></div>
      </div>
    </n-space>
    <n-text depth="3" class="sidebar-section">{{ t('app.workspace') }}</n-text>
    <n-menu :value="props.route" :options="menuOptions" />
  </div>
</template>
