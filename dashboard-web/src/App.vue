<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchState, type DashboardState } from './api/client';
import { filterSkills } from './domain/filterSkills';
import { resolveHash } from './domain/resolveHash';
import SkillRow from './components/SkillRow.vue';

const { t } = useI18n();

const state = ref<DashboardState | null>(null);
const loadError = ref<string | null>(null);
const query = ref('');

async function load() {
  loadError.value = null;
  try {
    state.value = await fetchState();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(() => {
  const resolved = resolveHash(location.hash);
  if (resolved.redirect) history.replaceState(null, '', location.pathname + location.search);
  void load();
});

const rows = computed(() => (state.value ? filterSkills(state.value.skills, query.value) : []));
const isFiltering = computed(() => query.value.trim() !== '');
</script>

<template>
  <main class="page">
    <header class="head">
      <h1>{{ t('library.title') }}</h1>
    </header>
    <p class="sub">{{ t('library.count', state?.skills.length ?? 0) }}</p>
    <div class="search-line">
      <input v-model="query" type="search" :placeholder="t('search.placeholder')" />
    </div>

    <div v-if="loadError" class="error">
      <p class="title">{{ t('error.loadFailed', { message: loadError }) }}</p>
      <button class="retry" @click="load">{{ t('error.retry') }}</button>
    </div>

    <template v-else-if="state">
      <div v-if="rows.length === 0" class="empty">
        <p class="title">
          {{ isFiltering ? t('empty.filtered.title', { query: query.trim() }) : t('empty.library.title') }}
        </p>
        <p class="hint">{{ isFiltering ? t('empty.filtered.hint') : t('empty.library.hint') }}</p>
      </div>
      <SkillRow
        v-for="skill in rows"
        :key="skill.name"
        :skill="skill"
        @distribute="() => {}"
        @update="() => {}"
        @more="() => {}"
      />
    </template>
  </main>
</template>
