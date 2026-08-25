<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  modelValue: string;
  recentPaths: string[];
  knownProjects: string[];
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'browse': [];
}>();

const { t } = useI18n();
const search = ref('');
const isOpen = ref(false);
const selectedIndex = ref(-1);

const filteredRecent = computed(() => {
  if (!search.value.trim()) return props.recentPaths;
  const q = search.value.toLowerCase();
  return props.recentPaths.filter(p => p.toLowerCase().includes(q));
});

const filteredKnown = computed(() => {
  if (!search.value.trim()) return props.knownProjects;
  const q = search.value.toLowerCase();
  return props.knownProjects.filter(p => p.toLowerCase().includes(q));
});

const hasRecent = computed(() => filteredRecent.value.length > 0);
const hasKnown = computed(() => filteredKnown.value.length > 0);

const allFiltered = computed(() => [
  ...filteredRecent.value.map(p => ({ path: p, group: 'recent' })),
  ...filteredKnown.value.map(p => ({ path: p, group: 'known' })),
]);

function select(path: string) {
  emit('update:modelValue', path);
  close();
}

function close() {
  isOpen.value = false;
  search.value = '';
  selectedIndex.value = -1;
}

function handleKeyDown(e: KeyboardEvent) {
  if (!isOpen.value && e.key === 'ArrowDown') {
    e.preventDefault();
    isOpen.value = true;
    selectedIndex.value = 0;
    return;
  }

  if (!isOpen.value) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      selectedIndex.value = Math.min(selectedIndex.value + 1, allFiltered.value.length - 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      selectedIndex.value = Math.max(selectedIndex.value - 1, -1);
      break;
    case 'Enter':
      e.preventDefault();
      if (selectedIndex.value >= 0) {
        select(allFiltered.value[selectedIndex.value].path);
      }
      break;
    case 'Escape':
      e.preventDefault();
      close();
      break;
  }
}

function handleInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  search.value = input.value;
  emit('update:modelValue', input.value);
  selectedIndex.value = -1;
  if (input.value.trim() && !isOpen.value) {
    isOpen.value = true;
  }
}
</script>

<template>
  <div class="project-dropdown">
    <input
      :value="modelValue"
      type="text"
      class="dropdown-input"
      :placeholder="placeholder"
      @input="handleInputChange"
      @keydown="handleKeyDown"
      @focus="isOpen = true"
    />

    <div v-if="isOpen" class="dropdown-overlay" @click="close" />

    <div v-if="isOpen" class="dropdown-menu">
      <!-- Browse button -->
      <button class="dropdown-browse" @click="emit('browse')">
        <span>📁</span>
        <span>{{ t('dropdown.browse') }}</span>
      </button>

      <div v-if="hasRecent || hasKnown" class="dropdown-items">
        <!-- Recent paths section -->
        <div v-if="hasRecent" class="dropdown-section">
          <div class="section-header">{{ t('dropdown.recentLabel') }}</div>
          <button
            v-for="(path, i) in filteredRecent"
            :key="`recent-${path}`"
            class="dropdown-item"
            :class="{ selected: selectedIndex === i }"
            @click="select(path)"
            @mouseenter="selectedIndex = i"
          >
            <span class="item-icon">🕐</span>
            <span class="item-label">{{ path.split('/').pop() || path }}</span>
            <span class="item-path">{{ path }}</span>
          </button>
        </div>

        <!-- Known projects section -->
        <div v-if="hasKnown" class="dropdown-section">
          <div class="section-header">{{ t('dropdown.knownLabel') }}</div>
          <button
            v-for="(path, i) in filteredKnown"
            :key="`known-${path}`"
            class="dropdown-item"
            :class="{ selected: selectedIndex === (hasRecent ? filteredRecent.length + i : i) }"
            @click="select(path)"
            @mouseenter="selectedIndex = (hasRecent ? filteredRecent.length : 0) + i"
          >
            <span class="item-icon">📂</span>
            <span class="item-label">{{ path.split('/').pop() || path }}</span>
            <span class="item-path">{{ path }}</span>
          </button>
        </div>
      </div>

      <!-- No results -->
      <div v-else class="dropdown-empty">
        <p>{{ t('dropdown.noMatch') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-dropdown {
  position: relative;
  width: 100%;
}

.dropdown-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.2s;
}

.dropdown-input:focus {
  border-color: var(--accent);
}

.dropdown-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 98;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 0.25rem;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 99;
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.dropdown-browse {
  padding: 0.75rem 1rem;
  background: var(--line2);
  border: none;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--fg);
  transition: background-color 0.2s;
}

.dropdown-browse:hover {
  background: var(--line);
}

.dropdown-items {
  display: flex;
  flex-direction: column;
}

.dropdown-section {
  border-bottom: 1px solid var(--line2);
}

.dropdown-section:last-child {
  border-bottom: none;
}

.section-header {
  padding: 0.5rem 1rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--fg3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: var(--bg);
}

.dropdown-item {
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--fg);
  font-size: 0.875rem;
  transition: background-color 0.15s;
}

.dropdown-item:hover,
.dropdown-item.selected {
  background: var(--line2);
}

.item-icon {
  flex-shrink: 0;
  font-size: 1rem;
}

.item-label {
  flex-shrink: 0;
  font-weight: 500;
  min-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-path {
  flex: 1;
  font-size: 0.75rem;
  color: var(--fg3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-empty {
  padding: 1rem;
  text-align: center;
  color: var(--fg3);
  font-size: 0.875rem;
}
</style>
