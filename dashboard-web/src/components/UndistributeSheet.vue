<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import DirectoryBrowser from './DirectoryBrowser.vue';
import ProjectDropdown from './ProjectDropdown.vue';
import { errorMessage, undistribute, type Scope } from '../api/client';
import { defaultProjectRoot, toggleAgent } from '../domain/picker';
import { useNotice } from '../composables/useNotice';
import { useBrowserHistory } from '../composables/useBrowserHistory';
import Check from './Check.vue';

const props = defineProps<{ skill: string; agents: string[]; knownProjects: string[] }>();
const emit = defineEmits<{ close: [] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { show } = useNotice();
const { recentPaths } = useBrowserHistory();

const scope = ref<Scope>('user');
const projectRoot = ref('');
const selection = ref<string[]>([...props.agents]);
const applying = ref(false);
const showBrowser = ref(false);

// Same gate as the distribute picker: no project path, no apply.
const projectPending = computed(() => scope.value === 'project' && projectRoot.value.trim() === '');

watch(scope, (next) => {
  selection.value = [...props.agents];
  // Same prefill as the distribute picker: the most recent project, if any.
  if (next === 'project') projectRoot.value = defaultProjectRoot(props.knownProjects);
});

function toggle(id: string) {
  selection.value = toggleAgent(selection.value, id);
}

function onBrowsedPath(path: string) {
  projectRoot.value = path;
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
  <Sheet :title="t('undistribute.title', { skill })" v-model:open="open" @closed="emit('close')">
    <p class="picker-hint">{{ t('undistribute.hint') }}</p>
    <div class="scope-row">
      <button class="tab" :class="scope === 'user' ? 'tab-on' : ''" @click="scope = 'user'">{{ t('picker.scopeUser') }}</button>
      <button class="tab" :class="scope === 'project' ? 'tab-on' : ''" @click="scope = 'project'">{{ t('picker.scopeProject') }}</button>
    </div>
    <div v-if="scope === 'project'" class="pb-[1rem]">
      <ProjectDropdown
        v-model="projectRoot"
        :recent-paths="recentPaths"
        :known-projects="knownProjects"
        :placeholder="t('picker.projectRoot')"
        @browse="showBrowser = true"
      />
    </div>

    <p v-if="agents.length === 0" class="picker-hint">{{ t('undistribute.none') }}</p>
    <div v-else class="agent-list">
      <label v-for="id in agents" :key="id" class="agent-row">
        <Check :checked="selection.includes(id)" @toggle="toggle(id)" />
        <span class="agent-id mono">{{ id }}</span>
      </label>
    </div>

    <div class="sheet-foot">
      <button class="text-btn" @click="emit('close')">{{ t('undistribute.cancel') }}</button>
      <button class="primary-btn" :disabled="selection.length === 0 || applying || projectPending" @click="apply">
        {{ applying ? t('picker.applying') : t('undistribute.apply') }}
      </button>
    </div>
  </Sheet>

  <DirectoryBrowser
    v-model:open="showBrowser"
    :initial-path="projectRoot.trim() ? projectRoot.trim() : undefined"
    @select="onBrowsedPath"
  />
</template>
