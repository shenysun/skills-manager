<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { deriveRowStatus, type RowStatus } from '../domain/rowStatus';
import type { SkillRowState } from '../api/client';

const props = defineProps<{ skill: SkillRowState }>();

defineEmits<{
  distribute: [name: string];
  update: [name: string];
  more: [name: string];
}>();

const { t } = useI18n();

const status = computed<RowStatus>(() => deriveRowStatus(props.skill));

const statusText = computed(() => {
  switch (status.value.kind) {
    case 'warning':
      return t('status.warning');
    case 'updatable':
      return t('status.updatable');
    case 'distributed':
      return t('status.agents', status.value.agentCount);
    case 'unlinked':
      return t('status.unlinked');
  }
});
</script>

<template>
  <div class="item">
    <div class="main">
      <div class="l1">
        <span class="name mono">{{ skill.name }}</span>
        <span class="meta" :class="status.kind">{{ statusText }}</span>
      </div>
      <div class="desc">{{ skill.description || t('row.noDescription') }}</div>
    </div>
    <div class="hover-acts">
      <button v-if="skill.hasUpdate" class="upd" @click="$emit('update', skill.name)">{{ t('action.update') }}</button>
      <button @click="$emit('distribute', skill.name)">{{ t('action.distribute') }}</button>
      <button @click="$emit('more', skill.name)">{{ t('action.more') }}</button>
    </div>
  </div>
</template>
