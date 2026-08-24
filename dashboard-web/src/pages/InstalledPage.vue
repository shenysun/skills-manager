<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NCheckbox, NCode, NEllipsis, NSpace, NTag, NText, useDialog, type DataTableColumns } from 'naive-ui';
import SkillDrawer from '../components/SkillDrawer.vue';
import AgentPickerSheet, { type AgentPickerPayload } from '../components/AgentPickerSheet.vue';
import ConsumerBadges from '../components/ConsumerBadges.vue';
import { ApiError, api, state, type Skill, type UpdateCandidate } from '../composables/useApi';
import { useOperationNotification } from '../composables/useOperationNotification';

const { t } = useI18n();
const { runWithNotification } = useOperationNotification();
const dialog = useDialog();
const search = ref('');
const consumer = ref<string | null>(null);
const selected = ref<string[]>([]);
const openSkill = ref<Skill | null>(null);
const busyAction = ref('');
const consumerOptions = computed(() => [{ label: t('common.all'), value: '' }, { label: 'agents', value: 'agents' }, { label: 'claude', value: 'claude' }]);
const candidateByName = computed(() => new Map((state.value?.candidates || []).map((candidate) => [candidate.skill, candidate])));
const updateCandidateNames = computed(() => (state.value?.candidates || []).map((candidate) => candidate.skill));

const filteredSkills = computed(() => {
  const query = search.value.trim().toLowerCase();
  const selectedConsumer = consumer.value || '';
  return (state.value?.skills || []).filter((skill) => {
    const candidate = candidateByName.value.get(skill.name);
    const matchesConsumer = !selectedConsumer || skill.consumers.includes(selectedConsumer);
    const values = [
      skill.name,
      skill.title || '',
      skill.description || '',
      skill.category || '',
      skill.path || '',
      skill.source?.url || '',
      skill.source?.subpath || '',
      candidate?.url || '',
      candidate?.subpath || '',
      ...(skill.tags || []),
      ...(skill.consumers || []),
    ];
    return matchesConsumer && (!query || values.some((value) => value.toLowerCase().includes(query)));
  });
});

const visibleSkillNames = computed(() => filteredSkills.value.map((skill) => skill.name));
const visibleUpdateableNames = computed(() => visibleSkillNames.value.filter((name) => candidateByName.value.has(name)));
const selectedUpdateableNames = computed(() => selected.value.filter((name) => candidateByName.value.has(name)));

const skillGroups = computed(() => {
  const groups = new Map<string, Skill[]>();
  for (const skill of filteredSkills.value) {
    const category = skill.category || t('installed.uncategorized');
    groups.set(category, [...(groups.get(category) || []), skill]);
  }
  return Array.from(groups.entries())
    .map(([category, skills]) => ({
      category,
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
      names: skills.map((skill) => skill.name),
      updateableNames: skills.filter((skill) => candidateByName.value.has(skill.name)).map((skill) => skill.name),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
});

function toggle(name: string, checked?: boolean) {
  const shouldSelect = checked ?? !selected.value.includes(name);
  selected.value = shouldSelect
    ? Array.from(new Set([...selected.value, name]))
    : selected.value.filter((skill) => skill !== name);
}

function selectedCount(names: string[]) {
  return names.filter((name) => selected.value.includes(name)).length;
}

function allSelected(names: string[]) {
  return names.length > 0 && selectedCount(names) === names.length;
}

function partiallySelected(names: string[]) {
  const count = selectedCount(names);
  return count > 0 && count < names.length;
}

function selectNames(names: string[]) {
  selected.value = Array.from(new Set([...selected.value, ...names]));
}

function clearNames(names: string[]) {
  selected.value = selected.value.filter((name) => !names.includes(name));
}

function clearSelected() {
  selected.value = [];
}

function sourceFor(skill: Skill, candidate?: UpdateCandidate) {
  return candidate?.url || skill.source?.url || t('common.local');
}

function pathFor(skill: Skill, candidate?: UpdateCandidate) {
  return candidate?.subpath || skill.source?.subpath || skill.path || '—';
}

function skillColumnsFor(groupNames: string[]): DataTableColumns<Skill> {
  return [
    {
      title: () => h(NCheckbox, {
        checked: allSelected(groupNames),
        indeterminate: partiallySelected(groupNames),
        disabled: !groupNames.length,
        'onUpdate:checked': (checked: boolean) => {
          if (checked) selectNames(groupNames);
          else clearNames(groupNames);
        },
      }),
      key: 'selected',
      width: 48,
      render: (skill) => h(NCheckbox, {
        checked: selected.value.includes(skill.name),
        onClick: (event: MouseEvent) => event.stopPropagation(),
        'onUpdate:checked': (checked: boolean) => toggle(skill.name, checked),
      }),
    },
    {
      title: t('common.skill'),
      key: 'skill',
      minWidth: 220,
      render: (skill) => h(NSpace, { vertical: true, size: 2 }, {
        default: () => [
          h(NText, { strong: true }, { default: () => skill.name }),
          h(NText, { depth: 3 }, { default: () => skill.description || skill.title || '—' }),
        ],
      }),
    },
    {
      title: t('common.status'),
      key: 'status',
      width: 130,
      render: (skill) => candidateByName.value.has(skill.name)
        ? h(NTag, { type: 'warning', size: 'small', round: true }, { default: () => t('installed.updateAvailable') })
        : h(NTag, { type: 'success', size: 'small', round: true }, { default: () => t('installed.upToDate') }),
    },
    {
      title: t('common.source'),
      key: 'source',
      minWidth: 260,
      render: (skill) => {
        const candidate = candidateByName.value.get(skill.name);
        return h(NSpace, { vertical: true, size: 2 }, {
          default: () => [
            h(NEllipsis, { style: 'max-width: 420px' }, { default: () => sourceFor(skill, candidate) }),
            candidate?.ref ? h(NTag, { size: 'small', round: true }, { default: () => candidate.ref }) : null,
          ],
        });
      },
    },
    {
      title: t('common.path'),
      key: 'path',
      minWidth: 220,
      render: (skill) => h(NCode, { code: pathFor(skill, candidateByName.value.get(skill.name)), wordWrap: true }),
    },
    {
      title: t('common.consumers'),
      key: 'consumers',
      width: 150,
      render: (skill) => h(ConsumerBadges, { consumers: skill.consumers || [] }),
    },
  ];
}

function rowProps(skill: Skill) {
  return {
    style: 'cursor: pointer',
    onClick: () => { openSkill.value = skill; },
  };
}

async function runSkillAction<T>(action: string, loading: string, success: string, fn: () => Promise<T>) {
  busyAction.value = action;
  try {
    return await runWithNotification(fn, { loading, success, error: t('notification.failed') });
  } finally {
    busyAction.value = '';
  }
}

async function confirmForeignThenRetry(retry: () => Promise<unknown>, message: string) {
  return new Promise<void>((resolve) => {
    dialog.warning({
      title: t('installed.foreignTitle'),
      content: message,
      positiveText: t('installed.forceOverwrite'),
      negativeText: t('common.cancel'),
      onPositiveClick: async () => {
        await retry();
        resolve();
      },
      onNegativeClick: () => resolve(),
      onClose: () => resolve(),
    });
  });
}

async function runDistributeAction(action: string, fn: (forceFlag: boolean) => Promise<unknown>, success: string) {
  busyAction.value = action;
  try {
    await runWithNotification(() => fn(false), { loading: t('loading.distributing'), success, error: t('notification.failed') });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'distribute_foreign_exists') {
      await confirmForeignThenRetry(
        () => runWithNotification(() => fn(true), { loading: t('loading.distributing'), success, error: t('notification.failed') }),
        error.message,
      );
      return;
    }
    throw error;
  } finally {
    busyAction.value = '';
  }
}

const updateCandidates = (skills: string[]) => runSkillAction('update-candidates', t('loading.updatingSelected'), t('notification.updateDone'), () => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills }) }));
const updateOne = (skill: string) => runSkillAction(`update-${skill}`, t('loading.updatingSkill', { skill }), t('notification.updateDone'), () => api('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills: [skill] }) }));
const targetKind = ref<'user' | 'project'>('user');
const projectRoot = ref('');

const pickerVisible = ref(false);
const pickerSkills = ref<string[]>([]);
const picker = ref<InstanceType<typeof AgentPickerSheet> | null>(null);

function openPicker(skills?: string) {
  pickerSkills.value = skills ? [skills] : selected.value;
  pickerVisible.value = true;
}

function pickerBody(payload: AgentPickerPayload) {
  return JSON.stringify({ to: payload.to, projectRoot: payload.projectRoot, skills: payload.skills, agents: payload.agents, mode: payload.mode, force: payload.force });
}

async function applyPicker(payload: AgentPickerPayload) {
  await runDistributeAction('picker-apply', (forceFlag) => api('/api/distribute', { method: 'POST', body: pickerBody({ ...payload, force: forceFlag || payload.force }) }), t('notification.distributeDone'));
  picker.value?.remember();
  pickerVisible.value = false;
}

async function removePicker(payload: AgentPickerPayload) {
  await runSkillAction('picker-remove', t('loading.undistributing'), t('notification.undistributeDone'), () => api('/api/undistribute', { method: 'POST', body: JSON.stringify({ to: payload.to, projectRoot: payload.projectRoot, skills: payload.skills, agents: payload.agents }) }));
  pickerVisible.value = false;
}

const redistributeOutdated = () => runDistributeAction('redistribute', (forceFlag) => api('/api/redistribute', { method: 'POST', body: JSON.stringify({ outdated: true, to: targetKind.value, projectRoot: targetKind.value === 'project' ? projectRoot.value : undefined, force: forceFlag }) }), t('notification.redistributeDone'));
const rollbackDistribute = () => runSkillAction('rollback', t('loading.distributing'), t('notification.rollbackDone'), () => api('/api/distribute/rollback', { method: 'POST', body: JSON.stringify({ to: targetKind.value, projectRoot: targetKind.value === 'project' ? projectRoot.value : undefined }) }));
const archive = (only?: string) => runSkillAction('archive', t('loading.archiving'), t('notification.archiveDone'), () => api('/api/skills/archive', { method: 'POST', body: JSON.stringify({ skills: only ? [only] : selected.value }) }));
</script>

<template>
  <n-space vertical size="large">
    <n-page-header :title="t('installed.title')">
      <template #subtitle>{{ t('installed.unifiedSubtitle') }}</template>
      <template #extra>
        <n-tag type="info" round>{{ selected.length }} {{ t('common.selected') }}</n-tag>
      </template>
    </n-page-header>

    <n-card class="action-center skills-workbench-card">
      <n-space vertical size="medium">
        <n-space align="center" justify="space-between" wrap>
          <div class="action-center-copy">
            <n-text strong>{{ t('installed.skillsWorkbench') }}</n-text>
            <n-text depth="3">{{ t('installed.skillsWorkbenchHint') }}</n-text>
          </div>
          <n-space align="center" wrap>
            <n-tag round>{{ t('installed.categoryGroupCount', { count: skillGroups.length }) }}</n-tag>
            <n-tag round>{{ t('installed.filteredCandidates', { count: filteredSkills.length }) }}</n-tag>
            <n-tag type="warning" round>{{ t('installed.updateCenterHint', { count: updateCandidateNames.length }) }}</n-tag>
            <n-tag type="info" round>{{ t('installed.selectedCandidates', { count: selected.length }) }}</n-tag>
          </n-space>
        </n-space>

        <n-space align="center" justify="space-between" wrap class="update-center-toolbar">
          <n-space align="center" wrap>
            <n-input v-model:value="search" clearable :placeholder="t('installed.unifiedSearchPlaceholder')" style="min-width: 340px" />
            <n-select v-model:value="consumer" :options="consumerOptions" clearable style="width: 140px" />
          </n-space>
          <n-space wrap>
            <n-button secondary :disabled="!visibleSkillNames.length" @click="selectNames(visibleSkillNames)">{{ t('installed.selectVisibleCandidates') }}</n-button>
            <n-button secondary :disabled="!visibleUpdateableNames.length" @click="selectNames(visibleUpdateableNames)">{{ t('installed.selectVisibleUpdateable') }}</n-button>
            <n-button secondary :disabled="!selected.length" @click="clearSelected">{{ t('installed.clearCandidates') }}</n-button>
            <n-button :disabled="!selectedUpdateableNames.length" :loading="busyAction === 'update-candidates'" type="primary" @click="updateCandidates(selectedUpdateableNames)">
              {{ t('installed.updateChecked', { count: selectedUpdateableNames.length }) }}
            </n-button>
            <n-button :disabled="!updateCandidateNames.length" :loading="busyAction === 'update-candidates'" @click="updateCandidates(updateCandidateNames)">{{ t('installed.updateAllCandidates') }}</n-button>
            <n-select v-model:value="targetKind" :options="[{ label: t('installed.distributeUser'), value: 'user' }, { label: t('installed.distributeProject'), value: 'project' }]" style="min-width: 280px" />
            <n-input v-if="targetKind === 'project'" v-model:value="projectRoot" :placeholder="t('installed.projectRoot')" style="min-width: 280px" />
            <n-button type="primary" :disabled="!selected.length" :loading="busyAction === 'picker-apply'" @click="openPicker()">{{ t('installed.connect') }}</n-button>
            <n-button secondary :loading="busyAction === 'redistribute'" @click="redistributeOutdated">{{ t('installed.redistributeOutdated') }}</n-button>
            <n-button secondary :loading="busyAction === 'rollback'" @click="rollbackDistribute">{{ t('installed.rollback') }}</n-button>
            <n-button :disabled="!selected.length" :loading="busyAction === 'archive'" type="error" secondary @click="archive()">{{ t('installed.archiveSelected') }}</n-button>
          </n-space>
        </n-space>

        <n-alert type="info" :show-icon="false">{{ t('installed.unifiedNotice') }}</n-alert>

        <div v-if="skillGroups.length" class="candidate-category-list skills-category-list">
          <n-card v-for="group in skillGroups" :key="group.category" size="small" class="candidate-category-card">
            <template #header>
              <n-space align="center" justify="space-between" wrap class="candidate-category-head">
                <n-space align="center" wrap>
                  <n-text strong>{{ group.category }}</n-text>
                  <n-tag size="small" round>{{ t('installed.filteredCandidates', { count: group.skills.length }) }}</n-tag>
                  <n-tag size="small" type="warning" round>{{ t('installed.updateableCount', { count: group.updateableNames.length }) }}</n-tag>
                  <n-tag size="small" :type="selectedCount(group.names) ? 'info' : 'default'" round>{{ t('installed.selectedCandidates', { count: selectedCount(group.names) }) }}</n-tag>
                </n-space>
                <n-space wrap>
                  <n-button size="small" secondary :disabled="allSelected(group.names)" @click="selectNames(group.names)">{{ t('installed.selectCategory') }}</n-button>
                  <n-button size="small" secondary :disabled="!group.updateableNames.length" @click="selectNames(group.updateableNames)">{{ t('installed.selectCategoryUpdateable') }}</n-button>
                  <n-button size="small" secondary :disabled="!selectedCount(group.names)" @click="clearNames(group.names)">{{ t('installed.clearCategory') }}</n-button>
                  <n-button size="small" type="primary" :disabled="!selectedCount(group.updateableNames)" :loading="busyAction === 'update-candidates'" @click="updateCandidates(group.updateableNames.filter((name) => selected.includes(name)))">
                    {{ t('installed.updateCategorySelected', { count: selectedCount(group.updateableNames) }) }}
                  </n-button>
                </n-space>
              </n-space>
            </template>
            <n-data-table
              :columns="skillColumnsFor(group.names)"
              :data="group.skills"
              :row-key="(row: Skill) => row.name"
              :row-props="rowProps"
              size="small"
              :bordered="false"
            />
          </n-card>
        </div>
        <n-empty v-else :description="t('installed.noSkillsMatch')" />
      </n-space>
    </n-card>

    <SkillDrawer :busy-action="busyAction" :skill="openSkill" @close="openSkill = null" @update="updateOne" @connect="(skill: string) => openPicker(skill)" @archive="archive" />
    <AgentPickerSheet ref="picker" :show="pickerVisible" :skills="pickerSkills" :busy-action="busyAction" @close="pickerVisible = false" @apply="applyPicker" @remove="removePicker" />
  </n-space>
</template>
