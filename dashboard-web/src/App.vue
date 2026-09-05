<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorMessage, fetchState, initPreview, removeSkills, updateSkills, type DashboardState, type RefreshResult, type SkillRowState } from './api/client';
import { filterSkills } from './domain/filterSkills';
import { removeConsequence } from './domain/remove';
import { resolveHash } from './domain/resolveHash';
import { exitSelection, idleSelection, isSelected, selectionCount, toggleSelection } from './domain/selection';
import { showUpdateStrip, updatableNames } from './domain/updateStrip';
import { useNotice } from './composables/useNotice';
import SkillRow from './components/SkillRow.vue';
import SkillPreviewSheet from './components/SkillPreviewSheet.vue';
import AgentPickerSheet from './components/AgentPickerSheet.vue';
import UndistributeSheet from './components/UndistributeSheet.vue';
import ConfirmSheet from './components/ConfirmSheet.vue';
import SelectionBar from './components/SelectionBar.vue';
import AddWizard from './components/AddWizard.vue';
import InitSheet from './components/InitSheet.vue';
import LogDrawer from './components/LogDrawer.vue';
import { useTheme } from './composables/useTheme';
import { useLocale } from './composables/useLocale';
import { ToastProvider } from 'reka-ui';
import NoticeToast from './components/NoticeToast.vue';


const { t } = useI18n();
const { notice, show } = useNotice();
const { theme, toggleTheme } = useTheme();
const { locale, setLocale } = useLocale();

const state = ref<DashboardState | null>(null);
const loadError = ref<string | null>(null);
const query = ref('');

// Overlays follow a session + open pair: the session ref keeps a payload and
// mounts the sheet fresh (state resets per open); `open` is the Dialog switch
// so Escape / ✕ / overlay close through Reka (focus restore) before the
// session ends. The log drawer carries no state and stays mounted, open-only.
const pickerSkills = ref<string[] | null>(null);
const pickerOpen = ref(false);
const previewTarget = ref<SkillRowState | null>(null);
const previewOpen = ref(false);
const undistributeTarget = ref<SkillRowState | null>(null);
const undistributeOpen = ref(false);
const removeTargets = ref<SkillRowState[] | null>(null);
const removeOpen = ref(false);
const addSession = ref(false);
const addOpen = ref(false);
const logOpen = ref(false);
const initSession = ref(false);
const initOpen = ref(false);
/** Empty-state onboarding: runtime skills init could fold in; null = not probed yet. */
const importableCount = ref<number | null>(null);

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
  // Only the updatable subset goes to the endpoint — a source-less skill in
  // the selection would fail the whole batch (update_source_missing).
  await runUpdate(updatableNames(selectedSkillStates.value));
  selection.value = exitSelection(selection.value);
}

function batchDistribute() {
  pickerSkills.value = [...selection.value.names];
  pickerOpen.value = true;
}

async function load() {
  loadError.value = null;
  try {
    state.value = await fetchState();
    if (state.value.skills.length === 0 && importableCount.value === null) {
      // Empty library: probe once whether init has anything to offer (ADR-0006).
      try {
        importableCount.value = (await initPreview()).discovered.length;
      } catch {
        importableCount.value = 0;
      }
    }
  } catch (error) {
    loadError.value = errorMessage(error);
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
  if (!selection.value.active || pickerSkills.value || undistributeTarget.value || removeTargets.value || previewTarget.value) return;
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

// ADR-0008: refresh one skill's stale copy targets. Backend returns the
// per-entry error list; we refetch state so the badge / warning / staleCount
// update from the new hub fingerprint, then toast per-entry failures.
async function onRefreshed(name: string, result: RefreshResult) {
  try {
    state.value = await fetchState();
    show(
      result.errored > 0 ? 'error' : 'ok',
      result.errored > 0
        ? t('notice.refreshErrors', { n: result.errored, first: result.errors[0]?.message ?? '' })
        : t('notice.refreshed', { skill: name }),
    );
  } catch (error) {
    show('error', errorMessage(error));
  }
}

async function runUpdate(names: string[]) {
  if (names.length === 0) return;
  updating.value = new Set(names);
  try {
    const { updated } = await updateSkills(names);
    show('ok', t('notice.updated', { skills: updated.join(', ') }));
  } catch (error) {
    // The rows stay as they are — hasUpdate is unchanged, so retry is possible.
    show('error', errorMessage(error));
  } finally {
    updating.value = new Set();
  }
  await load();
}

function openPicker(name: string) {
  pickerSkills.value = [name];
  pickerOpen.value = true;
}

function openPreview(skill: SkillRowState) {
  previewTarget.value = skill;
  previewOpen.value = true;
}

function openUndistribute(skill: SkillRowState) {
  undistributeTarget.value = skill;
  undistributeOpen.value = true;
}

function openRemove(skill: SkillRowState) {
  removeTargets.value = [skill];
  removeOpen.value = true;
}

function batchRemove() {
  removeTargets.value = selectedSkillStates.value;
  removeOpen.value = true;
}

function beginAdd() {
  addSession.value = true;
  addOpen.value = true;
}

function beginInit() {
  initSession.value = true;
  initOpen.value = true;
}

async function onAddClose() {
  addSession.value = false;
  addOpen.value = false;
  await load();
}

async function onInitClose() {
  initSession.value = false;
  initOpen.value = false;
  importableCount.value = null; // the next empty-state load re-probes
  await load();
}

async function onPickerClose() {
  pickerSkills.value = null;
  pickerOpen.value = false;
  selection.value = exitSelection(selection.value);
  await load();
}

async function onUndistributeClose() {
  undistributeTarget.value = null;
  undistributeOpen.value = false;
  await load();
}

function onRemoveCancel() {
  removeTargets.value = null;
  removeOpen.value = false;
}

function onPreviewClose() {
  previewTarget.value = null;
  previewOpen.value = false;
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
    // One toast replaces the previous (visual baseline 2026-08-27), so batch
    // the failures into a single message instead of flashing only the last.
    if (failed.length > 0) {
      show('error', failed.map((failure) => t('notice.removeFailed', { skill: failure.skill, message: failure.error.message })).join('; '));
    }
  } catch (error) {
    show('error', errorMessage(error));
  }
  await load();
}
</script>

<template>
  <ToastProvider disable-swipe :label="t('library.title')">
  <main class="mx-auto max-w-[720px] px-[24px] pb-[80px] pt-[56px]">

    <header class="mb-[6px] flex items-baseline gap-[12px]">
      <h1 class="text-[22px] font-bold tracking-[-0.01em]">{{ t('library.title') }}</h1>
      <div class="ml-auto flex gap-[16px] text-[13.5px] text-fg2">
        <button class="hover:text-fg" @click="logOpen = true">{{ t('log.link') }}</button>
        <button class="hover:text-fg" @click="beginAdd">{{ t('add.link') }}</button>
        <button class="hover:text-fg" @click="beginInit">{{ t('init.link') }}</button>
        <button class="hover:text-fg" :title="t('chrome.themeHint')" @click="toggleTheme">{{ theme === 'dark' ? '☀' : '◐' }}</button>
        <button class="hover:text-fg" @click="setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')">
          {{ locale === 'zh-CN' ? 'EN' : '中文' }}
        </button>
        <a class="text-inherit no-underline hover:text-fg" href="https://github.com/shenysun/skills-manager" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </header>
    <p class="mb-[18px] text-[13px] text-fg3">{{ t('library.count', state?.skills.length ?? 0) }}</p>
    <div class="mb-[8px] border-b border-line">
      <input
        v-model="query"
        type="search"
        class="w-full border-none bg-transparent py-[8px] px-[2px] text-[14.5px] outline-none placeholder:text-fg3"
        :placeholder="t('search.placeholder')"
      />
    </div>

    <p v-if="stripVisible" class="py-[10px] px-[2px] text-[14px] text-fg2">
      <b class="font-semibold text-fg">{{ t('strip.text', state?.updateCount ?? 0) }}</b>
      <button
        class="ml-[12px] font-semibold text-accent disabled:cursor-default disabled:opacity-60"
        :disabled="updating.size > 0"
        @click="runUpdate(updatableNames(state?.skills ?? []))"
      >
        {{ updatingAll ? t('strip.updating') : t('strip.updateAll') }}
      </button>
    </p>

    <div v-if="loadError" class="px-[2px] py-[48px] text-fg2">
      <p class="mb-[6px] text-[16px] font-semibold text-fg">{{ t('error.loadFailed', { message: loadError }) }}</p>
      <button class="mt-[10px] text-[13.5px] font-semibold text-accent" @click="load">{{ t('error.retry') }}</button>
    </div>

    <div v-else-if="!state" class="flex items-center justify-center gap-[10px] px-[2px] py-[48px] text-fg2" role="status">
      <span class="size-[12px] animate-spin rounded-full border-[1.5px] border-fg3 border-t-transparent" aria-hidden="true"></span>
      {{ t('library.loading') }}
    </div>

    <template v-else-if="state">
      <div v-if="rows.length === 0" class="px-[2px] py-[48px] text-fg2">
        <template v-if="!isFiltering && (importableCount ?? 0) > 0">
          <p class="mb-[6px] text-[16px] font-semibold text-fg">{{ t('empty.guided.title', importableCount ?? 0) }}</p>
          <p class="text-[13.5px] text-fg3">{{ t('empty.guided.hint') }}</p>
          <button class="primary-btn mt-[12px]" @click="beginInit">{{ t('empty.guided.action') }}</button>
        </template>
        <template v-else>
          <p class="mb-[6px] text-[16px] font-semibold text-fg">
            {{ isFiltering ? t('empty.filtered.title', { query: query.trim() }) : t('empty.library.title') }}
          </p>
          <p class="text-[13.5px] text-fg3">{{ isFiltering ? t('empty.filtered.hint') : t('empty.library.hint') }}</p>
        </template>
      </div>
      <SkillRow
        v-for="skill in rows"
        :key="skill.name"
        :skill="skill"
        :updating="updating.has(skill.name)"
        :selected="isSelected(selection, skill.name)"
        :selecting="selection.active"
        @toggle="onRowToggle"
        @distribute="openPicker"
        @update="(name) => runUpdate([name])"
        @undistribute="openUndistribute"
        @remove="openRemove"
        @preview="openPreview"
        @refreshed="onRefreshed"
      />
    </template>

    <AgentPickerSheet
      v-if="pickerSkills"
      v-model:open="pickerOpen"
      :skills="pickerSkills"
      :known-projects="state?.knownProjects ?? []"
      @close="onPickerClose"
    />
    <UndistributeSheet
      v-if="undistributeTarget"
      v-model:open="undistributeOpen"
      :skill="undistributeTarget.name"
      :agents="undistributeTarget.distributedAgents"
      :known-projects="state?.knownProjects ?? []"
      @close="onUndistributeClose"
    />
    <ConfirmSheet
      v-if="removeTargets && removeSummary"
      v-model:open="removeOpen"
      :title="t('remove.title')"
      :confirm-label="t('remove.confirm')"
      danger
      @cancel="onRemoveCancel"
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

    <AddWizard v-if="addSession" v-model:open="addOpen" @close="onAddClose" />

    <SkillPreviewSheet v-if="previewTarget" v-model:open="previewOpen" :skill="previewTarget" @close="onPreviewClose" />

    <InitSheet v-if="initSession" v-model:open="initOpen" @close="onInitClose" />

    <LogDrawer v-model:open="logOpen" :records="state?.activity ?? []" />

    <SelectionBar
      v-if="selection.active"
      :count="selectionCount(selection)"
      :busy="updating.size > 0"
      @update="batchUpdate"
      @distribute="batchDistribute"
      @remove="batchRemove"
      @cancel="selection = exitSelection(selection)"
    />

    <NoticeToast :notice="notice" :raised="selection.active" />
  </main>
  </ToastProvider>
</template>
