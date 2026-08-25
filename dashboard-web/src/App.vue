<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchState, type DashboardState, type SkillRowState } from './api/client';
import { filterSkills } from './domain/filterSkills';
import { resolveHash } from './domain/resolveHash';
import { useNotice } from './composables/useNotice';
import SkillRow from './components/SkillRow.vue';
import AgentPickerSheet from './components/AgentPickerSheet.vue';
import UndistributeSheet from './components/UndistributeSheet.vue';

const { t } = useI18n();
const { notice, show } = useNotice();

const state = ref<DashboardState | null>(null);
const loadError = ref<string | null>(null);
const query = ref('');

const pickerSkills = ref<string[] | null>(null);
const undistributeTarget = ref<SkillRowState | null>(null);

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

function openPicker(name: string) {
  pickerSkills.value = [name];
}

async function onPickerClose() {
  pickerSkills.value = null;
  await load();
}

async function onUndistributeClose() {
  undistributeTarget.value = null;
  await load();
}
</script>

<template>
  <main class="page">
    <header class="head">
      <h1>{{ t('library.title') }}</h1>
    </header>
    <p class="sub">{{ t('library.count', state?.skills.length ?? 0) }}</p>
    <p v-if="notice" class="notice" :class="notice.kind">{{ notice.text }}</p>
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
        @distribute="openPicker"
        @undistribute="(skill) => (undistributeTarget = skill)"
        @remove="() => {}"
      />
    </template>

    <AgentPickerSheet v-if="pickerSkills" :skills="pickerSkills" @close="onPickerClose" />
    <UndistributeSheet
      v-if="undistributeTarget"
      :skill="undistributeTarget.name"
      :agents="undistributeTarget.distributedAgents"
      @close="onUndistributeClose"
    />
  </main>
</template>
