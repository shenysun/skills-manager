<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NCard, NCheckbox, NEmpty, NInput, NModal, NRadioButton, NRadioGroup, NSelect, NSpace, NSpin, NTag, NText, NTooltip } from 'naive-ui';
import { api } from '../composables/useApi';

export type AgentPickerPayload = {
  to: 'user' | 'project';
  projectRoot?: string;
  skills: string[];
  agents: string[];
  mode?: string;
  force?: boolean;
};

type CatalogAgent = {
  id: string;
  label: string;
  detected: boolean;
  familyKey: string | null;
  invalidReason: string | null;
};

const props = defineProps<{ show: boolean; skills: string[]; busyAction?: string }>();
const emit = defineEmits<{ close: []; apply: [payload: AgentPickerPayload]; remove: [payload: AgentPickerPayload] }>();

const { t } = useI18n();

const scope = ref<'user' | 'project'>('user');
const projectRoot = ref('');
const search = ref('');
const mode = ref<string | null>(null);
const force = ref(false);
const agents = ref<CatalogAgent[]>([]);
const checked = ref<Set<string>>(new Set());
const loading = ref(false);

const memoryKey = (kind: 'user' | 'project') => `skills-manager.agent-picker.${kind}`;

function readMemory(kind: 'user' | 'project'): { agents: string[]; mode: string | null; projectRoot: string } | null {
  try {
    const raw = localStorage.getItem(memoryKey(kind));
    return raw ? (JSON.parse(raw) as { agents: string[]; mode: string | null; projectRoot: string }) : null;
  } catch {
    return null;
  }
}

/** Memory is exactly the last confirmed apply; called by the parent on success. */
function remember() {
  localStorage.setItem(memoryKey(scope.value), JSON.stringify({ agents: [...checked.value], mode: mode.value, projectRoot: projectRoot.value }));
}

defineExpose({ remember });

async function loadCatalog() {
  loading.value = true;
  try {
    const query = new URLSearchParams({ scope: scope.value });
    if (scope.value === 'project' && projectRoot.value.trim()) query.set('projectRoot', projectRoot.value.trim());
    const data = await api(`/api/catalog/agents?${query.toString()}`) as { scope: string; agents: CatalogAgent[] };
    agents.value = data.agents;
    applyMemoryOrDetected();
  } finally {
    loading.value = false;
  }
}

/** First open with no memory: pre-check detected agents. With memory: exactly the last confirmed apply. */
function applyMemoryOrDetected() {
  const memory = readMemory(scope.value);
  if (memory && memory.agents.length > 0) {
    checked.value = new Set(memory.agents);
    mode.value = memory.mode;
    if (scope.value === 'project' && memory.projectRoot) projectRoot.value = memory.projectRoot;
    return;
  }
  checked.value = new Set(agents.value.filter((agent) => agent.detected).map((agent) => agent.id));
}

watch(() => props.show, (show) => {
  if (!show) return;
  const memory = readMemory(scope.value);
  if (!memory) {
    checked.value = new Set();
    mode.value = null;
  }
  void loadCatalog();
});

watch(scope, () => {
  checked.value = new Set();
  mode.value = null;
  void loadCatalog();
});

watch(projectRoot, () => {
  if (scope.value === 'project') void loadCatalog();
});

const query = computed(() => search.value.trim().toLowerCase());

function matches(agent: CatalogAgent) {
  return !query.value || agent.id.toLowerCase().includes(query.value) || agent.label.toLowerCase().includes(query.value);
}

const detectedSection = computed(() => agents.value.filter((agent) => agent.detected && matches(agent)));

const catalogGroups = computed(() => {
  const rest = agents.value.filter((agent) => !agent.detected && matches(agent));
  const groups = new Map<string, CatalogAgent[]>();
  for (const agent of rest) {
    const key = agent.familyKey || `__invalid__${agent.id}`;
    groups.set(key, [...(groups.get(key) || []), agent]);
  }
  return Array.from(groups.entries()).map(([familyKey, members]) => ({ familyKey, members }));
});

function selectable(agent: CatalogAgent) {
  return !agent.invalidReason;
}

function isChecked(id: string) {
  return checked.value.has(id);
}

function setChecked(agent: CatalogAgent, value: boolean) {
  if (!selectable(agent)) return;
  const next = new Set(checked.value);
  if (value) next.add(agent.id);
  else next.delete(agent.id);
  checked.value = next;
}

function familyState(members: CatalogAgent[]) {
  const selectableMembers = members.filter(selectable);
  const count = selectableMembers.filter((agent) => checked.value.has(agent.id)).length;
  return { all: selectableMembers.length > 0 && count === selectableMembers.length, some: count > 0 && count < selectableMembers.length, count };
}

function toggleFamily(members: CatalogAgent[], value: boolean) {
  const next = new Set(checked.value);
  for (const agent of members.filter(selectable)) {
    if (value) next.add(agent.id);
    else next.delete(agent.id);
  }
  checked.value = next;
}

function payload(): AgentPickerPayload {
  return {
    to: scope.value,
    projectRoot: scope.value === 'project' ? projectRoot.value.trim() || undefined : undefined,
    skills: props.skills,
    agents: [...checked.value].sort(),
    mode: mode.value || undefined,
    force: force.value,
  };
}

function confirmApply() {
  emit('apply', payload());
}

function confirmRemove() {
  emit('remove', payload());
}

function close() {
  // Cancel path: memory is untouched by design.
  emit('close');
}

const modePlaceholder = computed(() => (scope.value === 'user' ? t('picker.modeDefaultSymlink') : t('picker.modeDefaultCopy')));
</script>

<template>
  <n-modal :show="show" @update:show="(show: boolean) => { if (!show) close(); }">
    <n-card class="agent-picker-card" :title="t('picker.title', { count: props.skills.length })" size="medium" closable @close="close">
      <n-space vertical size="medium">
        <n-space align="center" justify="space-between" wrap>
          <n-space align="center" wrap>
            <n-radio-group v-model:value="scope" size="small">
              <n-radio-button value="user">{{ t('picker.scopeUser') }}</n-radio-button>
              <n-radio-button value="project">{{ t('picker.scopeProject') }}</n-radio-button>
            </n-radio-group>
            <n-input v-if="scope === 'project'" v-model:value="projectRoot" :placeholder="t('picker.projectRoot')" size="small" style="width: 280px" />
          </n-space>
          <n-input v-model:value="search" clearable :placeholder="t('picker.searchPlaceholder')" size="small" style="width: 240px" />
        </n-space>

        <n-spin :show="loading">
          <n-space vertical size="small" class="agent-picker-list">
            <div>
              <n-text depth="3" class="agent-picker-section">{{ t('picker.detectedSection') }} ({{ detectedSection.length }})</n-text>
              <n-space v-if="detectedSection.length" item-style="display: flex" size="small" wrap>
                <n-checkbox v-for="agent in detectedSection" :key="agent.id" :checked="isChecked(agent.id)" :disabled="!selectable(agent)" @update:checked="(value: boolean) => setChecked(agent, value)">
                  {{ agent.label }}
                </n-checkbox>
              </n-space>
              <n-empty v-else :description="t('picker.noResults')" size="small" />
            </div>

            <div>
              <n-text depth="3" class="agent-picker-section">{{ t('picker.allSection') }}</n-text>
              <n-space vertical size="small">
                <div v-for="group in catalogGroups" :key="group.familyKey" class="agent-picker-family">
                  <div class="agent-picker-family-head">
                    <n-checkbox :checked="familyState(group.members).all" :indeterminate="familyState(group.members).some" @update:checked="(value: boolean) => toggleFamily(group.members, value)">
                      <n-text code style="font-size: 12px">{{ group.familyKey.startsWith('__invalid__') ? '—' : group.familyKey }}</n-text>
                    </n-checkbox>
                    <n-tag size="tiny" round>{{ t('picker.familyCount', { count: group.members.length }) }}</n-tag>
                  </div>
                  <n-space item-style="display: flex" size="small" wrap class="agent-picker-family-body">
                    <n-tooltip v-for="agent in group.members" :key="agent.id" :disabled="!agent.invalidReason" trigger="hover">
                      <template #trigger>
                        <n-checkbox :checked="isChecked(agent.id)" :disabled="!selectable(agent)" @update:checked="(value: boolean) => setChecked(agent, value)">
                          {{ agent.label }}
                          <n-text v-if="agent.invalidReason" depth="3" style="font-size: 12px">· {{ agent.id }}</n-text>
                        </n-checkbox>
                      </template>
                      {{ agent.invalidReason }}
                    </n-tooltip>
                  </n-space>
                </div>
              </n-space>
            </div>
          </n-space>
        </n-spin>

        <n-space align="center" justify="space-between" wrap>
          <n-space align="center" wrap>
            <n-select v-model:value="mode" clearable :placeholder="modePlaceholder" :options="[{ label: t('installed.modeSymlink'), value: 'symlink' }, { label: t('installed.modeCopy'), value: 'copy' }]" size="small" style="width: 220px" />
            <n-checkbox v-model:checked="force" size="small">{{ t('installed.forceOverwrite') }}</n-checkbox>
            <n-tag size="small" round type="info">{{ t('picker.selectedCount', { count: checked.size }) }}</n-tag>
          </n-space>
          <n-space wrap>
            <n-button tertiary :disabled="!checked.size" :loading="busyAction === 'picker-remove'" @click="confirmRemove">{{ t('picker.remove') }}</n-button>
            <n-button type="primary" :disabled="!checked.size" :loading="busyAction === 'picker-apply'" @click="confirmApply">{{ t('picker.apply') }}</n-button>
          </n-space>
        </n-space>
      </n-space>
    </n-card>
  </n-modal>
</template>

<style scoped>
.agent-picker-card { width: 760px; max-width: 94vw; }
.agent-picker-list { max-height: 52vh; overflow-y: auto; }
.agent-picker-section { font-weight: 600; display: block; margin-bottom: 6px; }
.agent-picker-family { border-left: 2px solid var(--n-border-color, #efeff5); padding-left: 10px; }
.agent-picker-family-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.agent-picker-family-body { padding-left: 4px; }
</style>

