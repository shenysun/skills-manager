<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { deriveRowStatus, type RowStatus } from '../domain/rowStatus';
import { rowBodyClick, rowNameClick } from '../domain/rowClick';
import { refreshSkill, type SkillRowState } from '../api/client';
import RowMenu from './RowMenu.vue';

const props = defineProps<{ skill: SkillRowState; updating?: boolean; selected?: boolean; selecting?: boolean }>();
const menuOpen = ref(false);
const refreshing = ref(false);

const emit = defineEmits<{
  distribute: [name: string];
  update: [name: string];
  undistribute: [skill: SkillRowState];
  remove: [skill: SkillRowState];
  preview: [skill: SkillRowState];
  toggle: [name: string];
  refreshed: [name: string];
}>();

const { t } = useI18n();

const status = computed<RowStatus>(() => deriveRowStatus(props.skill));

const statusText = computed(() => {
  switch (status.value.kind) {
    case 'warning':
      return props.skill.warning === 'outdated-copy' ? t('status.warningOutdated') : t('status.warningBroken');
    case 'updatable':
      return t('status.updatable');
    case 'distributed':
      return t('status.agents', status.value.agentCount);
    case 'unlinked':
      return t('status.unlinked');
  }
});

// ADR-0005: outside selection mode the name opens the preview; inside it,
// every click on the row (the name included) toggles the checkbox.
function onNameClick() {
  if (rowNameClick(props.selecting ?? false) === 'toggle') {
    emit('toggle', props.skill.name);
  } else {
    emit('preview', props.skill);
  }
}

function onBodyClick() {
  if (rowBodyClick(props.selecting ?? false) === 'toggle') emit('toggle', props.skill.name);
}

// ADR-0008: refresh stale copy targets. Per-entry failures are surfaced by the
// backend via the `errors` array; we just notify the parent so it can refetch
// state (which will re-derive warning/staleCount).
async function onRefresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await refreshSkill(props.skill.name);
    emit('refreshed', props.skill.name);
  } finally {
    refreshing.value = false;
  }
}
</script>

<template>
  <div class="item" :class="{ 'menu-open': menuOpen }" @click="onBodyClick">
    <label class="cb" @click.stop>
      <input type="checkbox" :checked="selected" @change="$emit('toggle', skill.name)" />
    </label>
    <div class="main">
      <div class="l1">
        <!-- The row name is the preview entry (CONTEXT.md · Skill preview): link-styled, no whole-row click. -->
        <button class="name mono preview-link" :title="t('preview.openHint')" @click.stop="onNameClick">
          {{ skill.name }}
        </button>
        <span class="meta" :class="status.kind">{{ statusText }}</span>
        <!-- ADR-0008: stale count badge surfaces how many copy targets lag the hub. -->
        <span
          v-if="skill.staleCount > 0"
          class="meta stale-badge"
          :title="t('status.staleHint', { count: skill.staleCount })"
        >
          {{ t('status.staleBadge', { count: skill.staleCount }) }}
        </span>
      </div>
      <div class="desc">{{ skill.description || t('row.noDescription') }}</div>
    </div>
    <div class="hover-acts" @click.stop>
      <button v-if="skill.staleCount > 0" class="upd refresh" :disabled="refreshing" @click="onRefresh">
        {{ refreshing ? t('action.refreshing') : t('action.refresh') }}
      </button>
      <button v-if="skill.hasUpdate" class="upd" :disabled="updating" @click="$emit('update', skill.name)">
        {{ updating ? t('action.updating') : t('action.update') }}
      </button>
      <button @click="$emit('distribute', skill.name)">{{ t('action.distribute') }}</button>
      <RowMenu v-model="menuOpen" @preview="$emit('preview', skill)" @undistribute="$emit('undistribute', skill)" @remove="$emit('remove', skill)" />
    </div>
  </div>
</template>
