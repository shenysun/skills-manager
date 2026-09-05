<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import InlineSelect from './InlineSelect.vue';
import { errorMessage, initApply, initPreview, type InitConflict, type InitRunResult } from '../api/client';
import { addPrefer, movePrefer, preferOptions, removePrefer } from '../domain/initPrefer';
import { useNotice } from '../composables/useNotice';

const emit = defineEmits<{ close: [] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { show } = useNotice();

const preview = ref<InitRunResult | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
/** Conflict decisions made inline: skill -> runtime dir (a dir may serve several agents) or 'hub'. */
const resolve = ref<Record<string, string>>({});
/** Per-import conflict priority (ADR-0009); empty means do not guess. */
const prefer = ref<string[]>([]);

async function loadPreview() {
  preview.value = await initPreview({
    prefer: prefer.value.length > 0 ? prefer.value : undefined,
    resolve: Object.keys(resolve.value).length > 0 ? resolve.value : undefined,
  });
}

onMounted(async () => {
  try {
    await loadPreview();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});

watch(prefer, async () => {
  if (!preview.value) return;
  try {
    await loadPreview();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});

const conflictBySkill = computed(() => {
  const map = new Map<string, InitConflict>();
  for (const conflict of preview.value?.conflicts ?? []) map.set(conflict.skill, conflict);
  return map;
});

const sources = computed(() => preferOptions(preview.value?.scanned ?? []));

const remainingSources = computed(() => {
  const taken = new Set(prefer.value);
  const options = sources.value.filter((source) => !taken.has(source.value));
  return taken.has('hub') ? options : [...options, { value: 'hub', agentIds: [] as string[] }];
});

const importableCount = computed(() => {
  if (!preview.value) return 0;
  const unresolved = preview.value.conflicts.filter((conflict) => !resolve.value[conflict.skill]).length;
  return preview.value.discovered.length - unresolved;
});

function sourceLabel(value: string) {
  if (value === 'hub') return t('init.preferHub');
  const source = sources.value.find((item) => item.value === value);
  return source && source.agentIds.length > 0 ? `${value} (${source.agentIds.join(', ')})` : value;
}

function choicesFor(conflict: InitConflict) {
  const originChoices = conflict.locations.map((location) => ({ value: location.runtimeDir, label: location.runtimeDir }));
  return conflict.hub || conflict.kind === 'hub-vs-runtime' ? [...originChoices, { value: 'hub', label: t('init.keepHub') }] : originChoices;
}

async function runApply() {
  busy.value = true;
  error.value = null;
  try {
    const result = await initApply({
      resolve: resolve.value,
      prefer: prefer.value.length > 0 ? prefer.value : undefined,
    });
    if (result.imported.length > 0) show('ok', t('notice.imported', { skills: result.imported.join(', ') }));
    // One toast replaces the previous (visual baseline 2026-08-27), so batch
    // the failures into a single message instead of flashing only the last.
    if (result.failed.length > 0) {
      show('error', result.failed.map((failure) => t('notice.importFailed', { skill: failure.skill, message: failure.reason })).join('; '));
    }
    emit('close');
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Sheet :title="t('init.title')" v-model:open="open" @closed="emit('close')">
    <p v-if="error" class="picker-error">{{ error }}</p>
    <p v-else-if="!preview" class="picker-hint">{{ t('init.scanning') }}</p>
    <template v-else>
      <p class="picker-hint">{{ t('init.hint') }}</p>
      <div class="mb-[12px]">
        <p class="picker-hint">{{ t('init.preferHint') }}</p>
        <p v-if="prefer.length === 0" class="picker-hint">{{ t('init.preferEmpty') }}</p>
        <ol v-else class="mb-[8px] pl-[1.2rem]">
          <li v-for="(item, index) in prefer" :key="item" class="flex items-baseline gap-[8px] text-[13px]">
            <span class="mono mr-auto min-w-0 overflow-hidden text-ellipsis">{{ sourceLabel(item) }}</span>
            <button type="button" class="text-btn" :disabled="index === 0" @click="prefer = movePrefer(prefer, index, -1)">{{ t('init.preferUp') }}</button>
            <button type="button" class="text-btn" :disabled="index === prefer.length - 1" @click="prefer = movePrefer(prefer, index, 1)">{{ t('init.preferDown') }}</button>
            <button type="button" class="text-btn" @click="prefer = removePrefer(prefer, item)">{{ t('init.preferRemove') }}</button>
          </li>
        </ol>
        <!-- Always-placeholder picker: choosing an option appends it to the
             priority list; the control itself keeps no selection. -->
        <InlineSelect
          v-if="remainingSources.length > 0"
          :placeholder="t('init.preferAdd')"
          :options="remainingSources.map((source) => ({ value: source.value, label: sourceLabel(source.value) }))"
          @update:model-value="(value) => (prefer = addPrefer(prefer, value))"
        />
      </div>
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
              <InlineSelect
                v-model="resolve[skill.name]"
                :placeholder="t('init.choicePlaceholder')"
                :options="choicesFor(conflictBySkill.get(skill.name)!)"
              />
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
