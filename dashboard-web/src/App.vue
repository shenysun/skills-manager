<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchState, removeSkills, type DashboardState, type SkillRowState } from './api/client';
import { filterSkills } from './domain/filterSkills';
import { removeConsequence } from './domain/remove';
import { resolveHash } from './domain/resolveHash';
import { useNotice } from './composables/useNotice';
import SkillRow from './components/SkillRow.vue';
import AgentPickerSheet from './components/AgentPickerSheet.vue';
import UndistributeSheet from './components/UndistributeSheet.vue';
import ConfirmSheet from './components/ConfirmSheet.vue';

const { t } = useI18n();
const { notice, show } = useNotice();

const state = ref<DashboardState | null>(null);
const loadError = ref<string | null>(null);
const query = ref('');

const pickerSkills = ref<string[] | null>(null);
const undistributeTarget = ref<SkillRowState | null>(null);
const removeTargets = ref<SkillRowState[] | null>(null);

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

const removeSummary = computed(() => (removeTargets.value ? removeConsequence(removeTargets.value) : null));

async function onRemoveConfirm() {
  const targets = removeTargets.value ?? [];
  removeTargets.value = null;
  try {
    const { results } = await removeSkills(targets.map((skill) => skill.name));
    const done = results.filter((result) => result.ok).map((result) => result.skill);
    const failed = results.filter((result) => !result.ok);
    if (done.length > 0) show('ok', t('notice.removed', { skills: done.join(', ') }));
    for (const failure of failed) show('error', t('notice.removeFailed', { skill: failure.skill, message: failure.error.message }));
  } catch (error) {
    show('error', error instanceof Error ? error.message : String(error));
  }
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
        @remove="(skill) => (removeTargets = [skill])"
      />
    </template>

    <AgentPickerSheet v-if="pickerSkills" :skills="pickerSkills" @close="onPickerClose" />
    <UndistributeSheet
      v-if="undistributeTarget"
      :skill="undistributeTarget.name"
      :agents="undistributeTarget.distributedAgents"
      @close="onUndistributeClose"
    />
    <ConfirmSheet
      v-if="removeTargets && removeSummary"
      :title="t('remove.title')"
      :confirm-label="t('remove.confirm')"
      danger
      @cancel="removeTargets = null"
      @confirm="onRemoveConfirm"
    >
      <p>
        {{
          t('remove.consequence', {
            agents: removeSummary.agentCount,
            skills: removeSummary.skillCount,
          })
        }}
      </p>
      <p class="confirm-skills mono">{{ removeTargets.map((skill) => skill.name).join(' · ') }}</p>
    </ConfirmSheet>
  </main>
</template>
