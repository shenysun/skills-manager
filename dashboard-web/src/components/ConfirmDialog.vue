<script setup lang="ts">
defineProps<{ open: boolean; title: string; body?: string }>();
defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <n-modal :show="open" preset="dialog" :title="title" positive-text="OK" negative-text="Cancel" @positive-click="$emit('confirm')" @negative-click="$emit('cancel')" @close="$emit('cancel')">
    {{ body }}
  </n-modal>
</template>
