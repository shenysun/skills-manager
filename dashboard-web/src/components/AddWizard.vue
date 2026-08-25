<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import { ApiError, discover, errorMessage, installFromSource, type DiscoveredSkill } from '../api/client';
import { toggleAgent } from '../domain/picker';
import { useNotice } from '../composables/useNotice';

const emit = defineEmits<{ close: [] }>();

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

async function runDiscover() {
  if (sourceInput.value.trim() === '') return;
  busy.value = 'discover';
  error.value = null;
  try {
    const result = await discover(sourceInput.value.trim());
    discovered.value = result.discovered;
    existing.value = result.existing;
    selected.value = result.discovered.map((skill) => skill.subpath);
    step.value = 'pick';
  } catch (cause) {
    // Bad source or an illegal skill name in the tree — explain, stay on step 1.
    error.value = errorMessage(cause);
  } finally {
    busy.value = null;
  }
}

function toggle(subpath: string) {
  selected.value = toggleAgent(selected.value, subpath);
}

async function runInstall(overwrite: boolean) {
  busy.value = 'install';
  error.value = null;
  overwriteAsk.value = null;
  try {
    const result = await installFromSource({ source: sourceInput.value.trim(), subpaths: selected.value, overwrite });
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
  <Sheet :title="t('add.title')" @cancel="emit('close')">
    <template v-if="step === 'source'">
      <div class="field-line">
        <input
          v-model="sourceInput"
          type="text"
          :placeholder="t('add.sourcePlaceholder')"
          @keydown.enter="runDiscover"
        />
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
      <div class="agent-list">
        <label v-for="skill in discovered" :key="skill.subpath" class="agent-row">
          <input type="checkbox" :checked="selected.includes(skill.subpath)" @change="toggle(skill.subpath)" />
          <span class="agent-id mono">{{ skill.name }}</span>
          <span class="agent-label">
            {{ skill.description || t('row.noDescription') }}
            <em v-if="existing.includes(skill.name)" class="existing-mark">{{ t('add.existingBadge') }}</em>
          </span>
        </label>
      </div>

      <div v-if="overwriteAsk" class="overwrite-ask">
        <p>{{ t('add.overwriteBody', { skills: overwriteAsk.join(', ') }) }}</p>
        <div class="overwrite-actions">
          <button class="text-btn" @click="overwriteAsk = null">{{ t('remove.cancel') }}</button>
          <button class="primary-btn danger" @click="runInstall(true)">{{ t('add.overwriteConfirm') }}</button>
        </div>
      </div>
      <p v-else-if="error" class="picker-error">{{ error }}</p>

      <div class="sheet-foot">
        <button class="text-btn" @click="step = 'source'">{{ t('add.back') }}</button>
        <span class="picker-count">{{ t('add.selected', selected.length) }}</span>
        <button class="text-btn" @click="emit('close')">{{ t('add.cancel') }}</button>
        <button class="primary-btn" :disabled="busy !== null || selected.length === 0" @click="runInstall(false)">
          {{ busy === 'install' ? t('add.installing') : t('add.install') }}
        </button>
      </div>
    </template>
  </Sheet>
</template>
