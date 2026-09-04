<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxViewport,
} from 'reka-ui';

const props = defineProps<{
  modelValue: string;
  recentPaths: string[];
  knownProjects: string[];
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  browse: [];
}>();

const { t } = useI18n();

const query = computed(() => props.modelValue.trim().toLowerCase());

const filteredRecent = computed(() => {
  if (!query.value) return props.recentPaths;
  return props.recentPaths.filter((path) => path.toLowerCase().includes(query.value));
});

const filteredKnown = computed(() => {
  if (!query.value) return props.knownProjects;
  return props.knownProjects.filter((path) => path.toLowerCase().includes(query.value));
});

function onInput(value: string) {
  emit('update:modelValue', value);
}

function onSelect(value: string) {
  emit('update:modelValue', value);
}
</script>

<template>
  <ComboboxRoot
    class="relative w-full"
    :model-value="modelValue"
    :ignore-filter="true"
    :reset-search-term-on-blur="false"
    open-on-focus
    @update:model-value="onSelect"
  >
    <ComboboxAnchor class="w-full">
      <ComboboxInput
        class="w-full rounded-[4px] border border-line bg-bg px-[0.75rem] py-[0.5rem] text-[0.875rem] text-fg outline-none focus:border-accent"
        :display-value="() => modelValue"
        :placeholder="placeholder"
        @update:model-value="onInput"
      />
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        class="z-[99] max-h-[300px] w-[var(--reka-combobox-trigger-width)] overflow-hidden rounded-[4px] border border-line bg-bg shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
        position="popper"
        :side-offset="4"
      >
        <button
          type="button"
          class="flex w-full items-center gap-[0.5rem] border-b border-line bg-line2 px-[1rem] py-[0.75rem] text-[0.875rem] text-fg hover:bg-line"
          @pointerdown.prevent
          @click="emit('browse')"
        >
          <span>📁</span>
          <span>{{ t('dropdown.browse') }}</span>
        </button>
        <ComboboxViewport class="max-h-[240px] overflow-y-auto">
          <ComboboxEmpty class="px-[1rem] py-[1rem] text-center text-[0.875rem] text-fg3">
            {{ t('dropdown.noMatch') }}
          </ComboboxEmpty>
          <ComboboxGroup v-if="filteredRecent.length > 0">
            <ComboboxLabel class="bg-bg px-[1rem] py-[0.5rem] text-[0.7rem] font-semibold tracking-[0.08em] text-fg3 uppercase">
              {{ t('dropdown.recentLabel') }}
            </ComboboxLabel>
            <ComboboxItem
              v-for="path in filteredRecent"
              :key="`recent-${path}`"
              class="flex cursor-pointer items-center gap-[0.75rem] px-[1rem] py-[0.75rem] text-[0.875rem] text-fg outline-none data-[highlighted]:bg-line2"
              :value="path"
              :text-value="path"
            >
              <span class="shrink-0">🕐</span>
              <span class="min-w-[120px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                {{ path.split('/').pop() || path }}
              </span>
              <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem] text-fg3">
                {{ path }}
              </span>
            </ComboboxItem>
          </ComboboxGroup>
          <ComboboxGroup v-if="filteredKnown.length > 0">
            <ComboboxLabel class="bg-bg px-[1rem] py-[0.5rem] text-[0.7rem] font-semibold tracking-[0.08em] text-fg3 uppercase">
              {{ t('dropdown.knownLabel') }}
            </ComboboxLabel>
            <ComboboxItem
              v-for="path in filteredKnown"
              :key="`known-${path}`"
              class="flex cursor-pointer items-center gap-[0.75rem] px-[1rem] py-[0.75rem] text-[0.875rem] text-fg outline-none data-[highlighted]:bg-line2"
              :value="path"
              :text-value="path"
            >
              <span class="shrink-0">📂</span>
              <span class="min-w-[120px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                {{ path.split('/').pop() || path }}
              </span>
              <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem] text-fg3">
                {{ path }}
              </span>
            </ComboboxItem>
          </ComboboxGroup>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
