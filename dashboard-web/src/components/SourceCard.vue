<script setup lang="ts">
import type { SourceGroup } from '../composables/useApi';
defineProps<{ source: SourceGroup; selected: string[] }>();
defineEmits<{ update: [key: string, skills?: string[]]; discover: [url: string]; toggle: [key: string, skill: string] }>();
</script>
<template>
  <article class="card source-card">
    <div><strong>{{ source.url }}</strong><span v-if="source.ref" class="pill">{{ source.ref }}</span></div>
    <div class="check-list"><label v-for="candidate in source.skills" :key="candidate.skill"><input type="checkbox" :checked="selected.includes(candidate.skill)" @change="$emit('toggle', source.key, candidate.skill)"> {{ candidate.skill }} <code>{{ candidate.subpath }}</code></label></div>
    <div class="toolbar"><button @click="$emit('update', source.key)">Update all</button><button :disabled="!selected.length" @click="$emit('update', source.key, selected)">Update selected</button><button @click="$emit('discover', source.url)">Discover more</button></div>
  </article>
</template>
