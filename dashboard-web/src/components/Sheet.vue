<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

defineProps<{ title: string }>();
const emit = defineEmits<{ cancel: [] }>();

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel');
}

// Body scroll lock lives in the Sheet base so every layer (picker, undistribute,
// wizard, confirm) inherits it. A module-level counter — not a boolean — keeps
// nested sheets locked until the last one closes; `scrollbar-gutter: stable`
// (tokens.css) stops the hidden scrollbar from shifting the page sideways.
let openSheets = 0;
let savedOverflow = '';

function acquireScrollLock() {
  if (openSheets === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openSheets += 1;
}

function releaseScrollLock() {
  openSheets = Math.max(0, openSheets - 1);
  if (openSheets === 0) document.body.style.overflow = savedOverflow;
}

onMounted(() => {
  acquireScrollLock();
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  releaseScrollLock();
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <div class="sheet-overlay" @click.self="emit('cancel')">
      <div class="sheet" role="dialog" :aria-label="title">
        <div class="sheet-head">
          <h2>{{ title }}</h2>
          <button class="sheet-close" @click="emit('cancel')">✕</button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
