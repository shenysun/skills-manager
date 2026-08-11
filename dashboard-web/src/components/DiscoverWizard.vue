<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { NCheckbox, NCode, NTag, NText, type DataTableColumns } from 'naive-ui';
import { api, state } from '../composables/useApi';
import { useOperationNotification } from '../composables/useOperationNotification';

type Discovered = { name: string; title: string; description: string; subpath: string };

const props = defineProps<{ presetSource?: string }>();
const { t } = useI18n();
const { runWithNotification } = useOperationNotification();
const source = ref(props.presetSource || localStorage.getItem('skills-manager-last-source') || '');
if (source.value) localStorage.removeItem('skills-manager-last-source');
watch(() => props.presetSource, (value) => {
  if (value) source.value = value;
});

const discovered = ref<Discovered[]>([]);
const selected = ref<string[]>([]);
const consumers = ref<string[]>(['agents', 'claude']);
const confirmOverwrite = ref(false);
const discovering = ref(false);
const installing = ref(false);
const existing = computed(() => new Set(state.value?.skills.map((skill) => skill.name) || []));
const selectedExisting = computed(() => discovered.value.filter((skill) => selected.value.includes(skill.subpath) && existing.value.has(skill.name)));
const requiresOverwrite = computed(() => selectedExisting.value.length > 0);
const canInstall = computed(() => selected.value.length > 0 && (!requiresOverwrite.value || confirmOverwrite.value));

const columns = computed<DataTableColumns<Discovered>>(() => [
  {
    title: '',
    key: 'selected',
    width: 48,
    render: (skill) => h(NCheckbox, {
      checked: selected.value.includes(skill.subpath),
      'onUpdate:checked': (checked: boolean) => {
        selected.value = checked ? [...selected.value, skill.subpath] : selected.value.filter((item) => item !== skill.subpath);
      },
    }),
  },
  {
    title: t('common.skill'),
    key: 'skill',
    minWidth: 220,
    render: (skill) => h('div', [
      h(NText, { strong: true }, { default: () => skill.name }),
      h('br'),
      h(NText, { depth: 3 }, { default: () => skill.description || skill.title || '—' }),
    ]),
  },
  { title: t('common.path'), key: 'subpath', minWidth: 220, render: (skill) => h(NCode, { code: skill.subpath, wordWrap: true }) },
  {
    title: t('common.status'),
    key: 'status',
    width: 130,
    render: (skill) => h(NTag, { type: existing.value.has(skill.name) ? 'warning' : 'success', round: true, size: 'small' }, { default: () => existing.value.has(skill.name) ? t('common.overwrite') : t('common.new') }),
  },
]);

async function discover() {
  discovering.value = true;
  try {
    const result = await runWithNotification(() => api<{ discovered: Discovered[] }>('/api/discover', { method: 'POST', body: JSON.stringify({ source: source.value }) }), { loading: t('loading.discovering'), success: t('notification.discoverDone'), error: t('notification.failed') });
    discovered.value = result.discovered;
    selected.value = [];
    confirmOverwrite.value = false;
  } finally {
    discovering.value = false;
  }
}

async function install() {
  installing.value = true;
  try {
    await runWithNotification(() => api('/api/install', {
      method: 'POST',
      body: JSON.stringify({
        source: source.value,
        subpaths: selected.value,
        consumers: consumers.value,
        overwrite: requiresOverwrite.value && confirmOverwrite.value,
      }),
    }), { loading: t('loading.installing'), success: t('notification.installDone'), error: t('notification.failed') });
  } finally {
    installing.value = false;
  }
}
</script>

<template>
  <n-card class="wizard-card">
    <n-space vertical size="large">
      <div class="wizard-header">
        <div class="action-center-copy">
          <n-text strong>{{ t('discover.title') }}</n-text>
          <n-text depth="3">{{ t('discover.compactHint') }}</n-text>
        </div>
        <n-input-group class="wizard-source-input">
          <n-input v-model:value="source" :placeholder="t('discover.sourcePlaceholder')" clearable />
          <n-button type="primary" :disabled="!source" :loading="discovering" @click="discover">{{ t('common.run') }}</n-button>
        </n-input-group>
      </div>

      <n-alert v-if="discovered.length" type="info" :show-icon="false">
        {{ t('discover.discovered', { count: discovered.length }) }}
      </n-alert>

      <n-data-table :columns="columns" :data="discovered" :row-key="(row: Discovered) => row.subpath" size="small" :bordered="false" />

      <div class="wizard-review">
        <n-card size="small" :title="t('discover.stepConsumers')">
          <n-checkbox-group v-model:value="consumers">
            <n-space>
              <n-checkbox value="agents">agents</n-checkbox>
              <n-checkbox value="claude">claude</n-checkbox>
            </n-space>
          </n-checkbox-group>
        </n-card>

        <n-card size="small" :title="t('discover.stepReview')">
          <n-space vertical>
            <n-alert :type="requiresOverwrite ? 'warning' : 'success'">
              {{ requiresOverwrite ? t('discover.overwrite') : t('discover.noOverwriteRequired') }}
            </n-alert>
            <n-checkbox v-model:checked="confirmOverwrite" :disabled="!requiresOverwrite">
              {{ t('discover.overwriteConfirm') }}
            </n-checkbox>
          </n-space>
        </n-card>

        <n-card size="small" class="wizard-submit">
          <n-space vertical>
            <n-text depth="3">{{ t('discover.selectedCount', { count: selected.length }) }}</n-text>
            <n-button block type="primary" :disabled="!canInstall" :loading="installing" @click="install">
              {{ t('common.install') }}
            </n-button>
          </n-space>
        </n-card>
      </div>
    </n-space>
  </n-card>
</template>
