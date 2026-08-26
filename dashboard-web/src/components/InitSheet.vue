<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import { errorMessage, initApply, initPreview, type InitConflict, type InitRunResult } from '../api/client';
import { useNotice } from '../composables/useNotice';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const { show } = useNotice();

const preview = ref<InitRunResult | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
/** Conflict decisions made inline: skill -> runtime dir (a dir may serve several agents) or 'hub'. */
const resolve = ref<Record<string, string>>({});

onMounted(async () => {
  try {
    preview.value = await initPreview();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});

const conflictBySkill = computed(() => {
  const map = new Map<string, InitConflict>();
  for (const conflict of preview.value?.conflicts ?? []) map.set(conflict.skill, conflict);
  return map;
});

const importableCount = computed(() => {
  if (!preview.value) return 0;
  const unresolved = preview.value.conflicts.filter((conflict) => !resolve.value[conflict.skill]).length;
  return preview.value.discovered.length - unresolved;
});

/** Choices for a clash: every clashing origin dir (the dir is the identity — it may serve several agents), plus the hub copy when one exists there. */
function choicesFor(conflict: InitConflict) {
  const originChoices = conflict.locations.map((location) => ({ value: location.runtimeDir, label: location.runtimeDir }));
  return conflict.kind === 'hub-vs-runtime' ? [...originChoices, { value: 'hub', label: t('init.keepHub') }] : originChoices;
}

async function runApply() {
  busy.value = true;
  error.value = null;
  try {
    const result = await initApply({ resolve: resolve.value });
    if (result.imported.length > 0) show('ok', t('notice.imported', { skills: result.imported.join(', ') }));
    for (const failure of result.failed) show('error', t('notice.importFailed', { skill: failure.skill, message: failure.reason }));
    emit('close');
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Sheet :title="t('init.title')" @cancel="emit('close')">
    <p v-if="error" class="picker-error">{{ error }}</p>
    <p v-else-if="!preview" class="picker-hint">{{ t('init.scanning') }}</p>
    <template v-else>
      <p class="picker-hint">{{ t('init.hint') }}</p>
      <div v-if="preview.discovered.length === 0 && preview.skippedManaged.length === 0" class="picker-hint">
        {{ t('init.empty') }}
      </div>
      <div v-else class="agent-list">
        <label v-for="skill in preview.discovered" :key="skill.name" class="agent-row">
          <span class="agent-id mono">{{ skill.name }}</span>
          <span class="agent-label">
            {{ skill.title }}
            <em v-if="preview.skippedManaged.includes(skill.name)" class="existing-mark">{{ t('init.managedBadge') }}</em>
            <template v-if="conflictBySkill.has(skill.name)">
              <em class="existing-mark">{{ t('init.conflictBadge') }}</em>
              <select v-model="resolve[skill.name]" class="init-choice">
                <option :value="undefined">{{ t('init.choicePlaceholder') }}</option>
                <option v-for="choice in choicesFor(conflictBySkill.get(skill.name)!)" :key="choice.value" :value="choice.value">
                  {{ choice.label }}
                </option>
              </select>
            </template>
          </span>
        </label>
      </div>
      <div class="sheet-foot">
        <span class="picker-count">{{ t('init.selected', importableCount) }}</span>
        <button class="text-btn" @click="emit('close')">{{ t('init.cancel') }}</button>
        <button
          class="primary-btn"
          :disabled="busy || importableCount === 0"
          @click="runApply"
        >
          {{ busy ? t('init.applying') : t('init.apply') }}
        </button>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.init-choice {
  margin-left: 0.5rem;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}
</style>
