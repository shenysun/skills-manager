<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchState, removeSkills, updateSkills, type DashboardState, type SkillRowState } from './api/client';
import { filterSkills } from './domain/filterSkills';
import { removeConsequence } from './domain/remove';
import { resolveHash } from './domain/resolveHash';
import { exitSelection, idleSelection, isSelected, selectionCount, toggleSelection } from './domain/selection';
import { showUpdateStrip, updatableNames } from './domain/updateStrip';
import { useNotice } from './composables/useNotice';
import SkillRow from './components/SkillRow.vue';
import AgentPickerSheet from './components/AgentPickerSheet.vue';
import UndistributeSheet from './components/UndistributeSheet.vue';
import ConfirmSheet from './components/ConfirmSheet.vue';
import SelectionBar from './components/SelectionBar.vue';
import AddWizard from './components/AddWizard.vue';
import LogDrawer from './components/LogDrawer.vue';
import { useTheme } from './composables/useTheme';
import { useLocale } from './composables/useLocale';

const { t } = useI18n();
const { notice, show } = useNotice();
const { theme, toggleTheme } = useTheme();
const { locale, setLocale } = useLocale();

const state = ref<DashboardState | null>(null);
const loadError = ref<string | null>(null);
const query = ref('');

const pickerSkills = ref<string[] | null>(null);
const undistributeTarget = ref<SkillRowState | null>(null);
const removeTargets = ref<SkillRowState[] | null>(null);
const addOpen = ref(false);
const logOpen = ref(false);

const selection = ref(idleSelection);
watchEffect(() => {
  document.body.classList.toggle('selecting', selection.value.active);
});

function onRowToggle(name: string) {
  selection.value = toggleSelection(selection.value, name);
}

const selectedSkillStates = computed(() => {
  if (!state.value) return [];
  return state.value.skills.filter((skill) => isSelected(selection.value, skill.name));
});

async function batchUpdate() {
  await runUpdate([...selection.value.names]);
  selection.value = exitSelection(selection.value);
}

function batchDistribute() {
  pickerSkills.value = [...selection.value.names];
}

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
  window.addEventListener('keydown', onKeydown);
  void load();
});

onUnmounted(() => window.removeEventListener('keydown', onKeydown));

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  // A sheet open means the sheet owns Escape; selection exits only on a bare page.
  if (!selection.value.active || pickerSkills.value || undistributeTarget.value || removeTargets.value) return;
  selection.value = exitSelection(selection.value);
}

const rows = computed(() => (state.value ? filterSkills(state.value.skills, query.value) : []));
const isFiltering = computed(() => query.value.trim() !== '');

const updating = ref(new Set<string>());
const stripVisible = computed(() => state.value !== null && showUpdateStrip(state.value.updateCount));
const updatingAll = computed(() => {
  const names = state.value ? updatableNames(state.value.skills) : [];
  return names.length > 0 && names.every((name) => updating.value.has(name));
});

async function runUpdate(names: string[]) {
  if (names.length === 0) return;
  updating.value = new Set(names);
  try {
    const { updated } = await updateSkills(names);
    show('ok', t('notice.updated', { skills: updated.join(', ') }));
  } catch (error) {
    // The rows stay as they are — hasUpdate is unchanged, so retry is possible.
    show('error', error instanceof Error ? error.message : String(error));
  } finally {
    updating.value = new Set();
  }
  await load();
}

function openPicker(name: string) {
  pickerSkills.value = [name];
}

function batchRemove() {
  removeTargets.value = selectedSkillStates.value;
}

async function onAddClose() {
  addOpen.value = false;
  await load();
}

async function onPickerClose() {
  pickerSkills.value = null;
  selection.value = exitSelection(selection.value);
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
  selection.value = exitSelection(selection.value);
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
      <div class="links">
        <button @click="logOpen = true">{{ t('log.link') }}</button>
        <button @click="addOpen = true">{{ t('add.link') }}</button>
        <button :title="t('chrome.themeHint')" @click="toggleTheme">{{ theme === 'dark' ? '☀' : '◐' }}</button>
        <button @click="setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')">
          {{ locale === 'zh-CN' ? 'EN' : '中文' }}
        </button>
      </div>
    </header>
    <p class="sub">{{ t('library.count', state?.skills.length ?? 0) }}</p>
    <p v-if="notice" class="notice" :class="notice.kind">{{ notice.text }}</p>
    <div class="search-line">
      <input v-model="query" type="search" :placeholder="t('search.placeholder')" />
    </div>

    <p v-if="stripVisible" class="update-line">
      <b>{{ t('strip.text', state?.updateCount ?? 0) }}</b>
      <button :disabled="updating.size > 0" @click="runUpdate(updatableNames(state?.skills ?? []))">
        {{ updatingAll ? t('strip.updating') : t('strip.updateAll') }}
      </button>
    </p>

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
        :updating="updating.has(skill.name)"
        :selected="isSelected(selection, skill.name)"
        @toggle="onRowToggle"
        @distribute="openPicker"
        @update="(name) => runUpdate([name])"
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

    <AddWizard v-if="addOpen" @close="onAddClose" />

    <LogDrawer v-if="logOpen" :records="state?.activity ?? []" @close="logOpen = false" />

    <SelectionBar
      v-if="selection.active"
      :count="selectionCount(selection)"
      :busy="updating.size > 0"
      @update="batchUpdate"
      @distribute="batchDistribute"
      @remove="batchRemove"
      @cancel="selection = exitSelection(selection)"
    />
  </main>
</template>
