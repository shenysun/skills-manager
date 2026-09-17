<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorMessage, fetchCost } from '../api/client';
import { formatApproxTokens, showCostLine, type CostLedger, type CostSkillLine } from '../domain/costLedger';

// The resident-cost line (ADR-0018, US21/US22): one glanceable line in the
// content area — same region and styling as the update strip — that expands
// inline into per-path groups. No sheet, no new chrome (ADR-0005). The ledger
// lazy-loads from /api/cost and never enters /api/state; a failed fetch just
// hides the line — the account is auxiliary, not a nag (US24).
const { t } = useI18n();

const ledger = ref<CostLedger | null>(null);

onMounted(async () => {
  try {
    ledger.value = await fetchCost();
  } catch {
    ledger.value = null;
  }
});

const visible = computed(() => showCostLine(ledger.value));
const total = computed(() => formatApproxTokens(ledger.value?.totalTokens ?? 0));

/** Per-skill row marks inside an expanded path group, in display order. */
function marks(line: CostSkillLine): string[] {
  return [line.archived ? t('cost.archived') : null, line.incomplete ? t('cost.incomplete') : null].filter(
    (mark): mark is string => mark !== null,
  );
}
</script>

<template>
  <details v-if="visible && ledger" class="py-[10px] px-[2px] text-[14px] text-fg2">
    <summary class="cursor-pointer list-none hover:text-fg">
      <b class="font-semibold text-fg">{{ t('cost.line', { tokens: total, n: ledger.paths.length }) }}</b>
    </summary>
    <div class="grid gap-[10px] pt-[8px] pb-[2px]">
      <div v-for="group in ledger.paths" :key="group.runtimeDir">
        <p
          class="mb-[2px] text-[12.5px] font-semibold text-fg2 [overflow-wrap:anywhere]"
          :class="{ mono: group.kind === 'project' }"
        >
          {{ group.kind === 'user' ? t('cost.user') : group.runtimeDir }}
          <span class="font-normal text-fg3">{{ group.agents.join(', ') }}</span>
          {{ formatApproxTokens(group.tokens) }}
        </p>
        <p v-for="line in group.skills" :key="line.skill" class="flex items-baseline gap-[12px] text-[12.5px] text-fg3">
          <span class="shrink-0">{{ formatApproxTokens(line.tokens) }}</span>
          <span class="mono [overflow-wrap:anywhere]">{{ line.skill }}</span>
          <span v-if="marks(line).length > 0" class="shrink-0">{{ marks(line).join(' · ') }}</span>
        </p>
      </div>
      <p v-if="ledger.unmanaged > 0" class="text-[12.5px] text-fg3">{{ t('cost.unmanaged', ledger.unmanaged) }}</p>
    </div>
  </details>
</template>
