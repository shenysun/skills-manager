<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import { errorMessage, undistribute, type Scope } from '../api/client';
import { defaultProjectRoot, toggleAgent } from '../domain/picker';
import { useNotice } from '../composables/useNotice';

const props = defineProps<{ skill: string; agents: string[]; knownProjects: string[] }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const { show } = useNotice();

const scope = ref<Scope>('user');
const projectRoot = ref('');
const selection = ref<string[]>([...props.agents]);
const applying = ref(false);

watch(scope, (next) => {
  selection.value = [...props.agents];
  // Same prefill as the distribute picker: the most recent project, if any.
  if (next === 'project') projectRoot.value = defaultProjectRoot(props.knownProjects);
});

function toggle(id: string) {
  selection.value = toggleAgent(selection.value, id);
}

async function apply() {
  applying.value = true;
  try {
    const { removed } = await undistribute({
      to: scope.value,
      projectRoot: scope.value === 'project' ? projectRoot.value.trim() || undefined : undefined,
      skills: [props.skill],
      agents: selection.value,
    });
    // Count what the endpoint actually removed — agents living only in the
    // other scope are silently inert there, so selection.length would lie.
    show('ok', t('notice.undistributed', { skill: props.skill, n: removed.length }));
    emit('close');
  } catch (error) {
    show('error', errorMessage(error));
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <Sheet :title="t('undistribute.title', { skill })" @cancel="emit('close')">
    <p class="picker-hint">{{ t('undistribute.hint') }}</p>
    <div class="scope-row">
      <button :class="{ on: scope === 'user' }" @click="scope = 'user'">{{ t('picker.scopeUser') }}</button>
      <button :class="{ on: scope === 'project' }" @click="scope = 'project'">{{ t('picker.scopeProject') }}</button>
    </div>
    <div v-if="scope === 'project'" class="field-line">
      <input v-model="projectRoot" type="text" :placeholder="t('picker.projectRoot')" list="undistribute-known-projects" />
      <datalist id="undistribute-known-projects">
        <option v-for="project in knownProjects" :key="project" :value="project" />
      </datalist>
    </div>

    <p v-if="agents.length === 0" class="picker-hint">{{ t('undistribute.none') }}</p>
    <div v-else class="agent-list">
      <label v-for="id in agents" :key="id" class="agent-row">
        <input type="checkbox" :checked="selection.includes(id)" @change="toggle(id)" />
        <span class="agent-id mono">{{ id }}</span>
      </label>
    </div>

    <div class="sheet-foot">
      <button class="text-btn" @click="emit('close')">{{ t('undistribute.cancel') }}</button>
      <button class="primary-btn" :disabled="selection.length === 0 || applying" @click="apply">
        {{ applying ? t('picker.applying') : t('undistribute.apply') }}
      </button>
    </div>
  </Sheet>
</template>
