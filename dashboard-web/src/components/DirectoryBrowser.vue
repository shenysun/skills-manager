<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import { browseDirectory, errorMessage, type BrowseDirectory } from '../api/client';

const props = defineProps<{ initialPath?: string }>();
const emit = defineEmits<{ select: [path: string]; cancel: [] }>();

const { t } = useI18n();

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
    emit('select', browse.value.path);
  }
}

watch(() => props.initialPath, () => {
  void load(props.initialPath);
}, { immediate: true });
</script>

<template>
  <Sheet :title="t('browser.title')" @cancel="emit('cancel')">
    <div v-if="loading" class="browser-loading">{{ t('browser.loading') }}</div>

    <div v-else-if="error" class="browser-error">{{ error }}</div>

    <div v-else-if="browse" class="browser-content">
      <!-- Breadcrumb navigation -->
      <div class="breadcrumb-row">
        <button v-if="browse.parent" class="breadcrumb-btn" @click="goParent">↑ {{ t('browser.up') }}</button>
        <div class="breadcrumb-path">
          <span v-for="(crumb, i) in pathBreadcrumbs" :key="crumb.path" class="breadcrumb-part">
            <span v-if="i > 0" class="breadcrumb-sep">/</span>
            <button class="breadcrumb-text" @click="navigateTo(crumb.path)">{{ crumb.text }}</button>
          </span>
        </div>
      </div>

      <!-- Directory list -->
      <div class="directory-list">
        <button v-if="browse.entries.length === 0" class="empty-hint" disabled>
          {{ t('browser.empty') }}
        </button>
        <button
          v-for="entry in browse.entries"
          :key="entry.path"
          class="dir-entry"
          @click="navigateTo(entry.path)"
        >
          <span class="dir-icon">📁</span>
          <span class="dir-name">{{ entry.name }}</span>
        </button>
      </div>
    </div>

    <div class="sheet-foot">
      <span></span>
      <button class="text-btn" @click="emit('cancel')">{{ t('browser.cancel') }}</button>
      <button class="primary-btn" :disabled="!browse" @click="select">{{ t('browser.select') }}</button>
    </div>
  </Sheet>
</template>

<style scoped>
.browser-loading,
.browser-error {
  padding: 1rem;
  text-align: center;
  color: var(--fg3);
}

.browser-error {
  color: var(--danger);
}

.browser-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  min-height: 300px;
}

.breadcrumb-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.breadcrumb-btn {
  padding: 0.4rem 0.8rem;
  background: var(--line2);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--fg2);
}

.breadcrumb-btn:hover {
  background: var(--line);
}

.breadcrumb-path {
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  overflow-x: auto;
  flex: 1;
  word-break: break-all;
}

.breadcrumb-part {
  display: flex;
  align-items: center;
}

.breadcrumb-sep {
  margin: 0 0.25rem;
  color: var(--fg3);
}

.breadcrumb-text {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
  font: inherit;
}

.breadcrumb-text:hover {
  text-decoration: underline;
}

.directory-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow-y: auto;
  flex: 1;
}

.dir-entry,
.empty-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: none;
  border: 1px solid var(--line2);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  text-align: left;
  color: var(--fg);
  transition: background-color 0.2s;
}

.dir-entry:hover {
  background: var(--line2);
}

.empty-hint {
  cursor: default;
  color: var(--fg3);
}

.dir-icon {
  flex-shrink: 0;
}

.dir-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-foot {
  padding: 1rem;
  border-top: 1px solid var(--line);
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
</style>
