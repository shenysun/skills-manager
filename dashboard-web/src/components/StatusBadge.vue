<script setup lang="ts">defineProps<{ ok?: boolean; label?: string }>();</script><template><span class="badge" :class="ok ? 'ok' : 'warn'">{{ label || (ok ? 'OK' : 'Check') }}</span></template>
