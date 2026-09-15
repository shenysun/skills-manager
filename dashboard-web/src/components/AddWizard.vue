<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import {
  ApiError,
  discover,
  errorMessage,
  installFromSource,
  type DiscoveredSkill,
  type MarketplacePlugin,
  type UrlPayloadFormat,
} from '../api/client';
import { toggleAgent } from '../domain/picker';
import { shouldAskFormat } from '../domain/formatAsk';
import { groupFullySelected, pluginGroups, toggleGroup, unsupportedReasonKey } from '../domain/wizardGroup';
import { useNotice } from '../composables/useNotice';
import Check from './Check.vue';

const emit = defineEmits<{ close: [] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { show } = useNotice();

const sourceInput = ref('');
const step = ref<'source' | 'pick'>('source');
const discovered = ref<DiscoveredSkill[]>([]);
const existing = ref<string[]>([]);
const selected = ref<string[]>([]);
const busy = ref<'discover' | 'install' | null>(null);
const error = ref<string | null>(null);
const overwriteAsk = ref<string[] | null>(null);
// The --format escape hatch (US-5): set only after the server reports a
// payload it cannot auto-identify — the happy path never sees the selector.
const forcedFormat = ref<UrlPayloadFormat | null>(null);
const formatAsk = ref(false);
// The US-12 plain-http confirmation, collected in-band the same way.
const insecureConfirmed = ref(false);
const insecureAsk = ref(false);
// Marketplace two-level view (US-15/17): null for every non-marketplace source.
const plugins = ref<MarketplacePlugin[] | null>(null);

const formatChoices: Array<{ value: UrlPayloadFormat; label: string }> = [
  { value: 'md', label: 'add.formatMd' },
  { value: 'zip', label: 'add.formatZip' },
  { value: 'tar', label: 'add.formatTar' },
];

/** Grouped pick rows when the source is a marketplace; null keeps the flat list. */
const groups = computed(() => pluginGroups(plugins.value, discovered.value));

function toggleGroupSelection(subpaths: string[]) {
  selected.value = toggleGroup(selected.value, subpaths);
}

async function runDiscover() {
  if (sourceInput.value.trim() === '') return;
  busy.value = 'discover';
  error.value = null;
  try {
    const result = await discover(sourceInput.value.trim(), { format: forcedFormat.value ?? undefined, allowInsecureHttp: insecureConfirmed.value || undefined });
    discovered.value = result.discovered;
    existing.value = result.existing;
    plugins.value = result.plugins;
    selected.value = result.discovered.map((skill) => skill.subpath);
    step.value = 'pick';
  } catch (cause) {
    // A payload the auto-judgment cannot identify — contradiction (mismatch)
    // or no verdict at all (invalid) — is the one state where the wizard asks
    // for a format (US-5/30); any other failure explains itself.
    if (cause instanceof ApiError && shouldAskFormat(cause.code, forcedFormat.value)) {
      formatAsk.value = true;
      return;
    }
    // Plain-http downloads install only with an explicit confirmation (US-12):
    // the wizard's in-band counterpart of the CLI's --yes.
    if (cause instanceof ApiError && cause.code === 'insecure_http_unconfirmed' && !insecureConfirmed.value) {
      insecureAsk.value = true;
      return;
    }
    error.value = errorMessage(cause);
  } finally {
    busy.value = null;
  }
}

function chooseFormat(format: UrlPayloadFormat) {
  forcedFormat.value = format;
  formatAsk.value = false;
  void runDiscover();
}

function confirmInsecureHttp() {
  insecureConfirmed.value = true;
  insecureAsk.value = false;
  void runDiscover();
}

function backToSource() {
  step.value = 'source';
  formatAsk.value = false;
  forcedFormat.value = null;
  insecureAsk.value = false;
  insecureConfirmed.value = false;
}

function toggle(subpath: string) {
  selected.value = toggleAgent(selected.value, subpath);
}

async function runInstall(overwrite: boolean) {
  busy.value = 'install';
  error.value = null;
  overwriteAsk.value = null;
  try {
    const result = await installFromSource({
      source: sourceInput.value.trim(),
      subpaths: selected.value,
      overwrite,
      format: forcedFormat.value ?? undefined,
      allowInsecureHttp: insecureConfirmed.value || undefined,
    });
    show('ok', t('notice.installed', { skills: result.installed.join(', ') }));
    emit('close');
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'install_would_overwrite') {
      const details = cause.details as { existing?: string[] } | undefined;
      overwriteAsk.value = details?.existing ?? [];
      return;
    }
    error.value = errorMessage(cause);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <Sheet :title="t('add.title')" v-model:open="open" @closed="emit('close')">
    <template v-if="step === 'source'">
      <div>
        <input
          v-model="sourceInput"
          type="text"
          class="field-input"
          :placeholder="t('add.sourcePlaceholder')"
          @keydown.enter="runDiscover"
        />
      </div>

      <div v-if="formatAsk" class="mt-[12px] rounded-[10px] border border-line p-[12px] text-[13.5px] text-fg2">
        <p>{{ t('add.formatAsk') }}</p>
        <div class="mt-[10px] flex flex-wrap gap-[10px]">
          <button v-for="choice in formatChoices" :key="choice.value" class="text-btn" @click="chooseFormat(choice.value)">
            {{ t(choice.label) }}
          </button>
        </div>
      </div>
      <div v-else-if="insecureAsk" class="mt-[12px] rounded-[10px] border border-line p-[12px] text-[13.5px] text-fg2">
        <p>{{ t('add.insecureAsk') }}</p>
        <div class="mt-[10px] flex justify-end gap-[14px]">
          <button class="text-btn" @click="insecureAsk = false">{{ t('add.cancel') }}</button>
          <button class="primary-btn" @click="confirmInsecureHttp">{{ t('add.insecureConfirm') }}</button>
        </div>
      </div>
      <p v-if="error" class="picker-error">{{ error }}</p>
      <div class="sheet-foot">
        <span></span>
        <button class="text-btn" @click="emit('close')">{{ t('add.cancel') }}</button>
        <button class="primary-btn" :disabled="busy !== null || sourceInput.trim() === ''" @click="runDiscover">
          {{ busy === 'discover' ? t('add.discovering') : t('add.discover') }}
        </button>
      </div>
    </template>

    <template v-else>
      <p class="picker-hint">{{ t('add.discoveredAt', { source: sourceInput }) }}</p>

      <template v-if="groups">
        <div v-for="group in groups" :key="group.name" class="agent-list">
          <div class="agent-row">
            <Check
              v-if="group.rows.length > 0"
              :checked="groupFullySelected(selected, group.subpaths)"
              @toggle="toggleGroupSelection(group.subpaths)"
            />
            <span v-else class="agent-row-spacer"></span>
            <span class="agent-id mono">{{ group.name }}</span>
            <span v-if="group.unsupported" class="agent-label">
              <em class="existing-mark">{{ t('add.pluginUnsupported', { reason: t(unsupportedReasonKey(group.unsupported)) }) }}</em>
            </span>
            <span v-else class="agent-label">{{ t('add.pluginSkills', group.rows.length) }}</span>
          </div>
          <label v-for="skill in group.rows" :key="skill.subpath" class="agent-row">
            <Check :checked="selected.includes(skill.subpath)" @toggle="toggle(skill.subpath)" />
            <span class="agent-id mono">{{ skill.name }}</span>
            <span class="agent-label">
              {{ skill.description || t('row.noDescription') }}
              <em v-if="existing.includes(skill.name)" class="existing-mark">{{ t('add.existingBadge') }}</em>
            </span>
          </label>
        </div>
      </template>

      <div v-else class="agent-list">
        <label v-for="skill in discovered" :key="skill.subpath" class="agent-row">
          <Check :checked="selected.includes(skill.subpath)" @toggle="toggle(skill.subpath)" />
          <span class="agent-id mono">{{ skill.name }}</span>
          <span class="agent-label">
            {{ skill.description || t('row.noDescription') }}
            <em v-if="existing.includes(skill.name)" class="existing-mark">{{ t('add.existingBadge') }}</em>
          </span>
        </label>
      </div>

      <div v-if="overwriteAsk" class="mt-[12px] rounded-[10px] border border-line p-[12px] text-[13.5px] text-fg2">
        <p>{{ t('add.overwriteBody', { skills: overwriteAsk.join(', ') }) }}</p>
        <div class="mt-[10px] flex justify-end gap-[14px]">
          <button class="text-btn" @click="overwriteAsk = null">{{ t('remove.cancel') }}</button>
          <button class="primary-btn bg-danger" @click="runInstall(true)">{{ t('add.overwriteConfirm') }}</button>
        </div>
      </div>
      <p v-else-if="error" class="picker-error">{{ error }}</p>

      <div class="sheet-foot">
        <button class="text-btn" @click="backToSource">{{ t('add.back') }}</button>
        <span class="picker-count">{{ t('add.selected', selected.length) }}</span>
        <button class="text-btn" @click="emit('close')">{{ t('add.cancel') }}</button>
        <button class="primary-btn" :disabled="busy !== null || selected.length === 0" @click="runInstall(false)">
          {{ busy === 'install' ? t('add.installing') : t('add.install') }}
        </button>
      </div>
    </template>
  </Sheet>
</template>
