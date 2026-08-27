<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import DirectoryBrowser from './DirectoryBrowser.vue';
import ProjectDropdown from './ProjectDropdown.vue';
import {
  distribute,
  errorMessage,
  fetchCatalogAgents,
  type CatalogAgent,
  type DistributeMode,
  type Scope,
} from '../api/client';
import {
  clearVisible,
  defaultProjectRoot,
  groupFamilies,
  initialSelection,
  searchAgents,
  selectAllVisible,
  selectDetectedVisible,
  toggleAgent,
  toggleFamily,
} from '../domain/picker';
import { usePickerMemory } from '../composables/usePickerMemory';
import { useNotice } from '../composables/useNotice';
import { useBrowserHistory } from '../composables/useBrowserHistory';

const props = defineProps<{ skills: string[]; knownProjects: string[] }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const { memory, rememberApply } = usePickerMemory();
const { show } = useNotice();
const { addPath: addProjectPath, recentPaths } = useBrowserHistory();

const scope = ref<Scope>('user');
const projectRoot = ref('');
const query = ref('');
const agents = ref<CatalogAgent[]>([]);
const loadError = ref<string | null>(null);
const applying = ref(false);
const mode = ref<DistributeMode>('symlink');
const selection = ref<string[]>([]);
const showBrowser = ref(false);

const defaultMode = (forScope: Scope): DistributeMode => (forScope === 'user' ? 'symlink' : 'copy');

async function loadAgents() {
  loadError.value = null;
  // No project named yet: the list waits (the backend rejects a rootless project
  // query) instead of guessing a directory the operator never chose.
  if (projectPending.value) {
    agents.value = [];
    selection.value = [];
    return;
  }
  try {
    const result = await fetchCatalogAgents(scope.value, scope.value === 'project' ? projectRoot.value : undefined);
    agents.value = result.agents;
    selection.value = initialSelection(result.agents, memory.value[scope.value] ?? null);
  } catch (error) {
    loadError.value = errorMessage(error);
  }
}

const projectPending = computed(() => scope.value === 'project' && projectRoot.value.trim() === '');

function rememberProjectPath() {
  const path = projectRoot.value.trim();
  if (path) {
    addProjectPath(path);
  }
}

watch(scope, (next) => {
  mode.value = defaultMode(next);
  if (next === 'project') projectRoot.value = defaultProjectRoot(props.knownProjects);
  void loadAgents();
});

void loadAgents();

const visible = computed(() => searchAgents(agents.value, query.value));
const detected = computed(() => visible.value.filter((agent) => agent.detected && agent.invalidReason === null));
const invalid = computed(() => visible.value.filter((agent) => agent.invalidReason !== null));

const grouping = computed(() => groupFamilies(visible.value));

const familyName = (familyKey: string) => familyKey.split('/').filter(Boolean).slice(-2).join('/') || familyKey;

/** The kept catalog endpoint returns English reasons; localize the known ones, pass the rest through. */
function reasonText(agent: CatalogAgent): string {
  if (/project-only/i.test(agent.invalidReason ?? '')) return t('picker.reasonProjectOnly');
  if (/cannot be resolved/i.test(agent.invalidReason ?? '')) return t('picker.reasonUnresolvable');
  return agent.invalidReason ?? '';
}

function onBrowsedPath(path: string) {
  projectRoot.value = path;
  showBrowser.value = false;
  void loadAgents();
}

async function apply() {
  applying.value = true;
  try {
    await distribute({
      to: scope.value,
      projectRoot: scope.value === 'project' ? projectRoot.value.trim() || undefined : undefined,
      skills: props.skills,
      agents: selection.value,
      mode: mode.value,
    });
    // A project path becomes "recent" only once an apply actually used it —
    // not on every keystroke of the input.
    if (scope.value === 'project') rememberProjectPath();
    rememberApply(scope.value, selection.value);
    show('ok', t('notice.distributed', { skills: props.skills.join(', '), n: selection.value.length }));
    emit('close');
  } catch (error) {
    show('error', errorMessage(error));
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <Sheet v-if="!showBrowser" :title="t('picker.title', { n: skills.length })" @cancel="emit('close')">
    <div class="picker-sticky">
      <div class="scope-row">
        <button :class="{ on: scope === 'user' }" @click="scope = 'user'">{{ t('picker.scopeUser') }}</button>
        <button :class="{ on: scope === 'project' }" @click="scope = 'project'">{{ t('picker.scopeProject') }}</button>
      </div>

      <div v-if="scope === 'project'" class="project-input-row">
        <ProjectDropdown
          v-model="projectRoot"
          :recent-paths="recentPaths"
          :known-projects="knownProjects"
          :placeholder="t('picker.projectRoot')"
          @update:model-value="() => void loadAgents()"
          @browse="showBrowser = true"
        />
      </div>

      <div class="field-line">
        <input v-model="query" type="search" :placeholder="t('picker.searchPlaceholder')" />
      </div>

      <div v-if="!loadError" class="quick-row">
        <button class="text-btn" @click="selection = selectAllVisible(agents, query, selection)">
          {{ t('picker.quick.selectAll') }}
        </button>
        <button class="text-btn" @click="selection = selectDetectedVisible(agents, query, selection)">
          {{ t('picker.quick.selectDetected') }}
        </button>
        <button class="text-btn" @click="selection = clearVisible(agents, query, selection)">
          {{ t('picker.quick.clear') }}
        </button>
      </div>
    </div>

    <p v-if="loadError" class="picker-error">{{ t('error.loadFailed', { message: loadError }) }}</p>

    <div v-else-if="projectPending" class="agent-list">
      <p class="picker-hint">{{ t('picker.projectHint') }}</p>
    </div>

    <div v-else class="agent-list">
      <section v-if="detected.length > 0">
        <h3>{{ t('picker.detected') }}</h3>
        <label v-for="agent in detected" :key="agent.id" class="agent-row">
          <input
            type="checkbox"
            :checked="selection.includes(agent.id)"
            @change="selection = toggleAgent(selection, agent.id)"
          />
          <span class="agent-id mono">{{ agent.id }}</span>
          <span class="agent-label">{{ agent.label }}</span>
        </label>
      </section>

      <section>
        <h3>{{ t('picker.allAgents') }}</h3>
        <div v-for="family in grouping.families" :key="family.familyKey" class="family">
          <button class="family-all" @click="selection = toggleFamily(visible, selection, family.familyKey)">
            {{ familyName(family.familyKey) }} · {{ t('picker.selectAll') }}
          </button>
          <label v-for="agent in family.members" :key="agent.id" class="agent-row">
            <input
              type="checkbox"
              :checked="selection.includes(agent.id)"
              @change="selection = toggleAgent(selection, agent.id)"
            />
            <span class="agent-id mono">{{ agent.id }}</span>
            <span class="agent-label">{{ agent.label }}</span>
          </label>
        </div>
        <label v-for="agent in grouping.singletons" :key="agent.id" class="agent-row">
          <input
            type="checkbox"
            :checked="selection.includes(agent.id)"
            @change="selection = toggleAgent(selection, agent.id)"
          />
          <span class="agent-id mono">{{ agent.id }}</span>
          <span class="agent-label">{{ agent.label }}</span>
        </label>
        <p v-if="grouping.families.length === 0 && grouping.singletons.length === 0" class="picker-hint">
          {{ t('picker.noMatch') }}
        </p>
      </section>

      <section v-if="invalid.length > 0">
        <h3>{{ t('picker.invalid') }}</h3>
        <label v-for="agent in invalid" :key="agent.id" class="agent-row invalid">
          <input type="checkbox" disabled />
          <span class="agent-id mono">{{ agent.id }}</span>
          <span class="agent-label">{{ reasonText(agent) }}</span>
        </label>
      </section>
    </div>

    <div class="mode-row">
      <span class="mode-label">{{ t('picker.mode') }}</span>
      <button :class="{ on: mode === 'symlink' }" @click="mode = 'symlink'">{{ t('picker.symlink') }}</button>
      <button :class="{ on: mode === 'copy' }" @click="mode = 'copy'">{{ t('picker.copy') }}</button>
    </div>

    <div class="sheet-foot">
      <span class="picker-count">{{ t('picker.selected', selection.length) }}</span>
      <button class="text-btn" @click="emit('close')">{{ t('picker.cancel') }}</button>
      <button class="primary-btn" :disabled="selection.length === 0 || applying || projectPending" @click="apply">
        {{ applying ? t('picker.applying') : t('picker.apply') }}
      </button>
    </div>
  </Sheet>

  <DirectoryBrowser
    v-else
    :initial-path="projectRoot.trim() ? projectRoot.trim() : undefined"
    @select="onBrowsedPath"
    @cancel="showBrowser = false"
  />
</template>

<style scoped>
.project-input-row {
  padding: 0 0 1rem 0;
}
</style>
