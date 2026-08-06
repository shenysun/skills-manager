<script setup lang="ts">
import ConsumerBadges from './ConsumerBadges.vue';
import type { Skill } from '../composables/useApi';
defineProps<{ skills: Skill[]; selected?: string[] }>();
defineEmits<{ toggle: [name: string]; open: [skill: Skill] }>();
</script>
<template>
  <div class="table-wrap"><table><thead><tr><th></th><th>Skill</th><th>Category</th><th>Consumers</th><th>Source</th></tr></thead><tbody>
    <tr v-for="skill in skills" :key="skill.name" @click="$emit('open', skill)">
      <td><input type="checkbox" :checked="selected?.includes(skill.name)" @click.stop="$emit('toggle', skill.name)" /></td>
      <td><strong>{{ skill.name }}</strong><br><span class="muted">{{ skill.description || skill.title }}</span></td>
      <td>{{ skill.category }}</td><td><ConsumerBadges :consumers="skill.consumers" /></td>
      <td><span class="muted">{{ skill.source?.url || 'local' }}</span><br><code>{{ skill.source?.subpath || skill.path }}</code></td>
    </tr>
  </tbody></table></div>
</template>
