<script setup lang="ts">
import ConsumerBadges from './ConsumerBadges.vue';
import type { Skill } from '../composables/useApi';
defineProps<{ skill: Skill | null }>();
defineEmits<{ close: []; update: [skill: string]; expose: [skill: string, consumer: string]; hide: [skill: string, consumer: string]; archive: [skill: string] }>();
</script>
<template>
  <aside v-if="skill" class="drawer">
    <button class="ghost" @click="$emit('close')">×</button>
    <h2>{{ skill.name }}</h2><p>{{ skill.description }}</p>
    <h3>Path</h3><code>{{ skill.path }}</code>
    <h3>Actions</h3><div class="toolbar"><button @click="$emit('update', skill.name)">Update</button><button @click="$emit('expose', skill.name, 'agents')">Expose agents</button><button @click="$emit('expose', skill.name, 'claude')">Expose claude</button><button @click="$emit('hide', skill.name, 'agents')">Hide agents</button><button @click="$emit('hide', skill.name, 'claude')">Hide claude</button><button class="danger" @click="$emit('archive', skill.name)">Archive</button></div>
    <h3>Consumers</h3><ConsumerBadges :consumers="skill.consumers"/>
    <h3>Source</h3><pre>{{ skill.source }}</pre>
    <h3>Files</h3><ul><li v-for="file in skill.files" :key="file"><code>{{ file }}</code></li></ul>
  </aside>
</template>
