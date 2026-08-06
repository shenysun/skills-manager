<script setup lang="ts">
import { useI18n } from 'vue-i18n';
defineProps<{ route: string }>();
const { t } = useI18n();
const nav = ['overview','installed','sources','discover','updates','registry','activity','settings'];
</script>
<template>
  <aside class="sidebar">
    <div class="brand"><div class="logo">SM</div><div><strong>{{ t('app.title') }}</strong><span>{{ t('app.subtitle') }}</span></div></div>
    <nav><a v-for="item in nav" :key="item" :href="`#/${item}`" :class="{active: route === item}">{{ t(`nav.${item}`) }}</a></nav>
  </aside>
</template>
