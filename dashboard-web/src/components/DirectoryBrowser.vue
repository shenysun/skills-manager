<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import { browseDirectory, errorMessage, type BrowseDirectory } from '../api/client';
import { useBrowserHistory } from '../composables/useBrowserHistory';

const props = defineProps<{ initialPath?: string }>();
const emit = defineEmits<{ select: [path: string] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { recentPaths, addPath } = useBrowserHistory();

const loading = ref(false);
const error = ref<string | null>(null);
const browse = ref<BrowseDirectory | null>(null);
const pathBreadcrumbs = computed(() => {
  if (!browse.value) return [];
  const parts = browse.value.path.split('/').filter(Boolean);
  const crumbs = parts.map((part, index) => ({
    text: part || '/',
    path: '/' + parts.slice(0, index + 1).join('/'),
  }));
  return crumbs;
});

async function load(path?: string) {
  loading.value = true;
  error.value = null;
  try {
    browse.value = await browseDirectory(path);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function navigateTo(path: string) {
  void load(path);
}

function goParent() {
  if (browse.value?.parent) {
    void load(browse.value.parent);
  }
}

function select() {
  if (browse.value) {
    addPath(browse.value.path);
    open.value = false;
    emit('select', browse.value.path);
  }
}

// Load lazily on open: a mounted-but-closed browser costs no request.
watch(open, (value) => {
  if (value) void load(props.initialPath);
});
</script>

<template>
  <Sheet :title="t('browser.title')" v-model:open="open">
    <!-- Recent paths quick access -->
    <div v-if="recentPaths.length > 0" class="border-b border-line2 px-[1rem] py-[0.75rem]">
      <div class="mb-[0.5rem] text-[0.75rem] font-semibold tracking-[0.08em] text-fg3 uppercase">{{ t('browser.recent') }}</div>
      <div class="flex flex-wrap gap-[0.5rem] overflow-x-auto overflow-y-hidden">
        <button
          v-for="path in recentPaths"
          :key="path"
          class="cursor-pointer rounded-[4px] border border-line bg-line2 px-[0.75rem] py-[0.4rem] text-[0.8rem] whitespace-nowrap text-fg2 transition-colors duration-200 hover:bg-line"
          :title="path"
          @click="navigateTo(path)"
        >
          {{ path.split('/').pop() || path }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex min-h-[200px] items-center justify-center p-[1rem] text-center text-fg3">
      {{ t('browser.loading') }}
    </div>

    <div v-else-if="error" class="flex min-h-[200px] items-center justify-center p-[1rem] text-center text-danger">
      {{ error }}
    </div>

    <div v-else-if="browse" class="flex max-h-[60vh] min-h-[300px] flex-col gap-[1rem] p-[1rem]">
      <!-- Breadcrumb navigation -->
      <div class="flex flex-wrap items-center gap-[0.5rem]">
        <button
          v-if="browse.parent"
          class="rounded-[4px] border border-line bg-line2 px-[0.8rem] py-[0.4rem] text-[0.875rem] text-fg2 hover:bg-line"
          @click="goParent"
        >
          ↑ {{ t('browser.up') }}
        </button>
        <div class="flex flex-1 items-center overflow-x-auto text-[0.875rem] break-all">
          <span v-for="(crumb, i) in pathBreadcrumbs" :key="crumb.path" class="flex items-center">
            <span v-if="i > 0" class="mx-[0.25rem] text-fg3">/</span>
            <button class="p-0 text-accent hover:underline" @click="navigateTo(crumb.path)">{{ crumb.text }}</button>
          </span>
        </div>
      </div>

      <!-- Directory list with max-height constraint -->
      <div class="flex flex-1 flex-col gap-[0.5rem] overflow-y-auto">
        <button
          v-if="browse.entries.length === 0"
          class="flex cursor-default items-center gap-[0.5rem] rounded-[4px] border border-line2 px-[0.75rem] py-[0.5rem] text-left text-[0.875rem] text-fg3"
          disabled
        >
          {{ t('browser.empty') }}
        </button>
        <button
          v-for="entry in browse.entries"
          :key="entry.path"
          class="flex items-center gap-[0.5rem] rounded-[4px] border border-line2 px-[0.75rem] py-[0.5rem] text-left text-[0.875rem] text-fg transition-colors duration-200 hover:bg-line2"
          @click="navigateTo(entry.path)"
        >
          <span class="shrink-0">📁</span>
          <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ entry.name }}</span>
        </button>
      </div>
    </div>

    <div class="sheet-foot">
      <span class="flex-1"></span>
      <button class="text-btn" @click="open = false">{{ t('browser.cancel') }}</button>
      <button class="primary-btn" :disabled="!browse" @click="select">{{ t('browser.select') }}</button>
    </div>
  </Sheet>
</template>
