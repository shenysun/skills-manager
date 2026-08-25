<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { deriveRowStatus, type RowStatus } from '../domain/rowStatus';
import { rowBodyClick, rowNameClick } from '../domain/rowClick';
import type { SkillRowState } from '../api/client';
import RowMenu from './RowMenu.vue';

const props = defineProps<{ skill: SkillRowState; updating?: boolean; selected?: boolean; selecting?: boolean }>();
const menuOpen = ref(false);

const emit = defineEmits<{
  distribute: [name: string];
  update: [name: string];
  undistribute: [skill: SkillRowState];
  remove: [skill: SkillRowState];
  preview: [skill: SkillRowState];
  toggle: [name: string];
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
      </div>
      <div class="desc">{{ skill.description || t('row.noDescription') }}</div>
    </div>
    <div class="hover-acts" @click.stop>
      <button v-if="skill.hasUpdate" class="upd" :disabled="updating" @click="$emit('update', skill.name)">
        {{ updating ? t('action.updating') : t('action.update') }}
      </button>
      <button @click="$emit('distribute', skill.name)">{{ t('action.distribute') }}</button>
      <RowMenu v-model="menuOpen" @preview="$emit('preview', skill)" @undistribute="$emit('undistribute', skill)" @remove="$emit('remove', skill)" />
    </div>
  </div>
</template>
