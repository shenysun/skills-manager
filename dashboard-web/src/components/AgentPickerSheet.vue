<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import {
  distribute,
  fetchCatalogAgents,
  type CatalogAgent,
  type DistributeMode,
  type Scope,
} from '../api/client';
import { initialSelection, searchAgents, toggleAgent, toggleFamily, selectableAgents } from '../domain/picker';
import { usePickerMemory } from '../composables/usePickerMemory';
import { useNotice } from '../composables/useNotice';

const props = defineProps<{ skills: string[] }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const { memory, rememberApply } = usePickerMemory();
const { show } = useNotice();

const scope = ref<Scope>('user');
const projectRoot = ref('');
const query = ref('');
const agents = ref<CatalogAgent[]>([]);
const loadError = ref<string | null>(null);
const applying = ref(false);
const mode = ref<DistributeMode>('symlink');
const selection = ref<string[]>([]);

const defaultMode = (forScope: Scope): DistributeMode => (forScope === 'user' ? 'symlink' : 'copy');

async function loadAgents() {
  loadError.value = null;
  try {
    const result = await fetchCatalogAgents(scope.value, scope.value === 'project' ? projectRoot.value : undefined);
    agents.value = result.agents;
    selection.value = initialSelection(result.agents, memory.value[scope.value] ?? null);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }
}

watch(scope, (next) => {
  mode.value = defaultMode(next);
  void loadAgents();
});

void loadAgents();

const visible = computed(() => searchAgents(agents.value, query.value));
const detected = computed(() => visible.value.filter((agent) => agent.detected && agent.invalidReason === null));
const invalid = computed(() => visible.value.filter((agent) => agent.invalidReason !== null));

const families = computed(() => {
  const byKey = new Map<string, CatalogAgent[]>();
  for (const agent of selectableAgents(visible.value)) {
    if (agent.familyKey === null) continue;
    byKey.set(agent.familyKey, [...(byKey.get(agent.familyKey) || []), agent]);
  }
  return [...byKey.entries()].map(([familyKey, members]) => ({ familyKey, members }));
});

const familyName = (familyKey: string) => familyKey.split('/').filter(Boolean).slice(-2).join('/') || familyKey;

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
    rememberApply(scope.value, selection.value);
    show('ok', t('notice.distributed', { skills: props.skills.join(', '), n: selection.value.length }));
    emit('close');
  } catch (error) {
    show('error', error instanceof Error ? error.message : String(error));
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <Sheet :title="t('picker.title', { n: skills.length })" @cancel="emit('close')">
    <div class="scope-row">
      <button :class="{ on: scope === 'user' }" @click="scope = 'user'">{{ t('picker.scopeUser') }}</button>
      <button :class="{ on: scope === 'project' }" @click="scope = 'project'">{{ t('picker.scopeProject') }}</button>
    </div>

    <div v-if="scope === 'project'" class="field-line">
      <input v-model="projectRoot" type="text" :placeholder="t('picker.projectRoot')" @change="loadAgents" />
    </div>

    <div class="field-line">
      <input v-model="query" type="search" :placeholder="t('picker.searchPlaceholder')" />
    </div>

    <p v-if="loadError" class="picker-error">{{ t('error.loadFailed', { message: loadError }) }}</p>

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
        <div v-for="family in families" :key="family.familyKey" class="family">
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
        <p v-if="families.length === 0" class="picker-hint">{{ t('picker.noMatch') }}</p>
      </section>

      <section v-if="invalid.length > 0">
        <h3>{{ t('picker.invalid') }}</h3>
        <label v-for="agent in invalid" :key="agent.id" class="agent-row invalid">
          <input type="checkbox" disabled />
          <span class="agent-id mono">{{ agent.id }}</span>
          <span class="agent-label">{{ agent.invalidReason }}</span>
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
      <button class="primary-btn" :disabled="selection.length === 0 || applying" @click="apply">
        {{ applying ? t('picker.applying') : t('picker.apply') }}
      </button>
    </div>
  </Sheet>
</template>
