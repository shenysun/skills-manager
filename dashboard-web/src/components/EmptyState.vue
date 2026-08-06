<script setup lang="ts">defineProps<{ title: string; body?: string }>();</script><template><div class="empty"><strong>{{ title }}</strong><p v-if="body">{{ body }}</p></div></template>
