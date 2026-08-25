<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

defineProps<{ title: string }>();
const emit = defineEmits<{ cancel: [] }>();

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel');
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
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
