<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ConsumerBadges from './ConsumerBadges.vue';
import type { Skill } from '../composables/useApi';

defineProps<{ skill: Skill | null; busyAction?: string }>();
defineEmits<{ close: []; update: [skill: string]; expose: [skill: string, consumer: string]; hide: [skill: string, consumer: string]; archive: [skill: string] }>();

const { t } = useI18n();
</script>

<template>
  <n-drawer :show="!!skill" :width="560" placement="right" @update:show="(show: boolean) => { if (!show) $emit('close') }">
    <n-drawer-content v-if="skill" :title="skill.name" closable>
      <n-space vertical size="large">
        <n-text>{{ skill.description || skill.title }}</n-text>

        <n-descriptions label-placement="top" bordered :column="1" size="small">
          <n-descriptions-item :label="t('common.path')">
            <n-code :code="skill.path" word-wrap />
          </n-descriptions-item>
          <n-descriptions-item :label="t('common.consumers')">
            <ConsumerBadges :consumers="skill.consumers" />
          </n-descriptions-item>
          <n-descriptions-item :label="t('common.source')">
            <n-code :code="JSON.stringify(skill.source, null, 2)" language="json" word-wrap />
          </n-descriptions-item>
        </n-descriptions>

        <n-card :title="t('common.actions')" size="small">
          <n-space wrap>
            <n-button type="primary" :loading="busyAction === `update-${skill.name}`" @click="$emit('update', skill.name)">{{ t('common.update') }}</n-button>
            <n-button :loading="busyAction === 'expose-agents'" @click="$emit('expose', skill.name, 'agents')">{{ t('installed.exposeConsumer', { consumer: 'agents' }) }}</n-button>
            <n-button :loading="busyAction === 'expose-claude'" @click="$emit('expose', skill.name, 'claude')">{{ t('installed.exposeConsumer', { consumer: 'claude' }) }}</n-button>
            <n-button :loading="busyAction === 'hide-agents'" tertiary @click="$emit('hide', skill.name, 'agents')">{{ t('installed.hideConsumer', { consumer: 'agents' }) }}</n-button>
            <n-button :loading="busyAction === 'hide-claude'" tertiary @click="$emit('hide', skill.name, 'claude')">{{ t('installed.hideConsumer', { consumer: 'claude' }) }}</n-button>
            <n-button :loading="busyAction === 'archive'" type="error" secondary @click="$emit('archive', skill.name)">{{ t('common.archive') }}</n-button>
          </n-space>
        </n-card>

        <n-card :title="t('common.files')" size="small">
          <n-list v-if="skill.files?.length" size="small">
            <n-list-item v-for="file in skill.files" :key="file">
              <n-code :code="file" word-wrap />
            </n-list-item>
          </n-list>
          <n-empty v-else :description="t('common.noFiles')" />
        </n-card>
      </n-space>
    </n-drawer-content>
  </n-drawer>
</template>
