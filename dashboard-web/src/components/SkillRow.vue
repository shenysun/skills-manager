<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { deriveRowStatus, type RowStatus } from '../domain/rowStatus';
import { rowBodyClick, rowNameClick } from '../domain/rowClick';
import { distCountsText } from '../domain/distribution';
import { refreshSkill, type RefreshResult, type SkillRowState } from '../api/client';
import RowMenu from './RowMenu.vue';
import Check from './Check.vue';

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
  refreshed: [name: string, result: RefreshResult];
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
      return distCountsText(t, status.value.agentCount, status.value.projectCount);
    case 'unlinked':
      return t('status.unlinked');
  }
});

const statusColor = computed(() => {
  switch (status.value.kind) {
    case 'warning':
      return 'text-warn';
    case 'updatable':
      return 'text-accent font-semibold';
    default:
      return 'text-fg3';
  }
});

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

async function onRefresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const result = await refreshSkill(props.skill.name);
    emit('refreshed', props.skill.name, result);
  } finally {
    refreshing.value = false;
  }
}
</script>

<template>
  <div
    class="group relative flex items-baseline gap-[10px] border-b border-line2 py-[13px] px-[2px]"
    @click="onBodyClick"
  >
    <span
      class="flex w-[22px] shrink-0 self-center transition-opacity duration-100"
      :class="selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      @click.stop
    >
      <Check :checked="selected" @toggle="$emit('toggle', skill.name)" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-[10px]">
        <button
          class="mono text-[15px] font-semibold hover:underline"
          :title="t('preview.openHint')"
          @click.stop="onNameClick"
        >
          {{ skill.name }}
        </button>
        <span
          class="ml-auto whitespace-nowrap text-[12.5px]"
          :class="[statusColor, menuOpen ? 'hidden' : 'group-hover:hidden']"
        >
          {{ statusText }}
        </span>
        <span
          v-if="skill.staleCount > 0"
          class="whitespace-nowrap text-[12.5px] text-warn"
          :class="menuOpen ? 'hidden' : 'group-hover:hidden'"
          :title="t('status.staleHint', { count: skill.staleCount })"
        >
          {{ t('status.staleBadge', { count: skill.staleCount }) }}
        </span>
      </div>
      <div class="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] text-fg2">
        {{ skill.description || t('row.noDescription') }}
      </div>
    </div>
    <!-- Actions stay in the DOM (opacity/pointer-events gated, zero layout
         footprint via absolute placement): a dialog opened from here can hand
         focus back to its trigger, and keyboard operators can reach them. -->
    <div
      class="absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-[12px] text-[13px] text-fg2 opacity-0 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
      :class="{ 'pointer-events-auto opacity-100': menuOpen }"
      @click.stop
    >
      <button
        v-if="skill.staleCount > 0"
        class="font-semibold text-accent hover:text-fg disabled:cursor-default disabled:opacity-60"
        :disabled="refreshing"
        @click="onRefresh"
      >
        {{ refreshing ? t('action.refreshing') : t('action.refresh') }}
      </button>
      <button
        v-if="skill.hasUpdate"
        class="font-semibold text-accent hover:text-fg disabled:cursor-default disabled:opacity-60"
        :disabled="updating"
        @click="$emit('update', skill.name)"
      >
        {{ updating ? t('action.updating') : t('action.update') }}
      </button>
      <button class="hover:text-fg" @click="$emit('distribute', skill.name)">{{ t('action.distribute') }}</button>
      <RowMenu v-model="menuOpen" @preview="$emit('preview', skill)" @undistribute="$emit('undistribute', skill)" @remove="$emit('remove', skill)" />
    </div>
  </div>
</template>
