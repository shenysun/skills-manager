<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import { errorMessage, fetchSkillFile, fetchSkillFiles, type SkillFileEntry, type SkillFilePayload, type SkillRowState } from '../api/client';
import { buildFileTree, defaultPreviewPath, type FileTreeNode } from '../domain/fileTree';
import { renderedView, togglePreviewView, type PreviewView } from '../domain/previewView';
import { sourceLink } from '../domain/sourceLink';
import { distCountsText, projectRootsOf } from '../domain/distribution';

// Read-only skill preview (CONTEXT.md): a wide Sheet over the library — head
// carries only name + actions; a meta zone below holds the full description
// and the 来源 · 接入 summary; then file tree left, file content right. The
// rendered view innerHTMLs only server-sanitized HTML.
const props = defineProps<{ skill: SkillRowState }>();
const emit = defineEmits<{ close: [] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();

const files = ref<SkillFileEntry[]>([]);
const selectedPath = ref<string | null>(null);
const file = ref<SkillFilePayload | null>(null);
const loadError = ref<string | null>(null);
const view = ref<PreviewView>(renderedView);

const src = computed(() => sourceLink(props.skill.source));
const projectRoots = computed(() => projectRootsOf(props.skill.distribution));
const distributed = computed(() => props.skill.distributedAgents.length > 0);
const distCounts = computed(() => distCountsText(t, props.skill.distributedAgents.length, projectRoots.value.length));

const tree = computed(() => buildFileTree(files.value.map((entry) => entry.path)));

const treeRows = computed(() => {
  const rows: Array<{ name: string; path: string; depth: number; isDir: boolean }> = [];
  const walk = (nodes: FileTreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ name: node.name, path: node.path, depth, isDir: node.children !== undefined });
      if (node.children) walk(node.children, depth + 1);
    }
  };
  walk(tree.value, 0);
  return rows;
});

async function select(path: string) {
  selectedPath.value = path;
  file.value = null;
  view.value = renderedView;
  try {
    file.value = await fetchSkillFile(props.skill.name, path);
  } catch (error) {
    loadError.value = errorMessage(error);
  }
}

onMounted(async () => {
  try {
    files.value = (await fetchSkillFiles(props.skill.name)).files;
    const initial = defaultPreviewPath(files.value.map((entry) => entry.path));
    if (initial) await select(initial);
  } catch (error) {
    loadError.value = errorMessage(error);
  }
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <Sheet wide :title="skill.name" v-model:open="open" @closed="emit('close')">
    <template #head>
      <button
        v-if="file?.kind === 'markdown'"
        class="text-btn shrink-0 whitespace-nowrap"
        @click="view = togglePreviewView(view)"
      >
        {{ view === 'rendered' ? t('preview.viewSource') : t('preview.viewRendered') }}
      </button>
    </template>

    <div class="mt-[2px] mb-[12px] shrink-0 border-b border-line2 pb-[10px]">
      <p v-if="skill.description" class="mb-[6px] text-[13.5px] leading-[1.65] text-fg2">{{ skill.description }}</p>
      <div v-if="src || distributed" class="flex flex-wrap items-baseline gap-x-[18px] gap-y-[4px] text-[12.5px] text-fg3">
        <span v-if="src">
          {{ t('preview.sourceLabel') }}
          <a v-if="src.href" class="text-accent" :href="src.href" target="_blank" rel="noreferrer">{{ src.label }}</a>
          <span v-else class="mono">{{ src.label }}</span>
        </span>
        <!-- 接入 reverse lookup: inline <details>, grouped by target (physical
             layer); shared runtime paths appear once, agents on each. -->
        <details v-if="distributed" class="min-w-0">
          <summary class="cursor-pointer text-fg3 hover:text-fg2">{{ t('preview.distPrefix') }} {{ distCounts }}</summary>
          <div class="grid gap-[10px] pt-[8px] pb-[2px]">
            <div v-for="target in skill.distribution" :key="target.targetRoot">
              <p
                class="mb-[2px] text-[12.5px] font-semibold text-fg2 [overflow-wrap:anywhere]"
                :class="{ mono: target.kind === 'project' }"
              >
                {{ target.kind === 'user' ? t('preview.distUser') : target.targetRoot }}
              </p>
              <p v-for="entry in target.entries" :key="entry.runtimePath" class="flex items-baseline gap-[12px] text-[12.5px] text-fg3">
                <span class="shrink-0">{{ entry.agents.join(', ') }}</span>
                <span class="mono [overflow-wrap:anywhere]">{{ entry.runtimePath }}</span>
              </p>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <aside v-if="treeRows.length" class="w-[240px] shrink-0 overflow-y-auto border-r border-line2 pt-[6px] pb-[16px]">
        <button
          v-for="row in treeRows"
          :key="row.path"
          class="mono block w-full overflow-hidden text-ellipsis whitespace-nowrap px-[10px] py-[3px] text-left text-[12.5px]"
          :class="[
            row.path === selectedPath ? 'bg-line2 text-accent' : '',
            row.isDir ? 'cursor-default font-semibold text-fg3' : 'text-fg2 hover:text-fg',
          ]"
          :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          :disabled="row.isDir"
          @click="select(row.path)"
        >
          {{ row.name }}
        </button>
      </aside>

      <div class="min-w-0 flex-1 overflow-y-auto px-[20px]">
        <p v-if="loadError" class="text-[13.5px] text-danger">{{ t('preview.loadFailed', { message: loadError }) }}</p>
        <p v-else-if="!file" class="text-[13px] text-fg3">{{ t('preview.loading') }}</p>
        <template v-else>
          <p v-if="file.kind !== 'binary' && file.truncated" class="text-[13px] text-warn">
            {{ t('preview.truncated') }}
          </p>
          <p v-if="file.kind === 'binary'" class="text-[13px] text-fg3">{{ t('preview.binary', { size: formatSize(file.size) }) }}</p>
          <!-- v-html is safe here: the server pipeline sanitizes everything it puts in html. -->
          <div v-if="file.kind === 'markdown' && view === 'rendered'" class="preview-md" v-html="file.html"></div>
          <pre v-else-if="file.kind === 'markdown'" class="mono break-words pt-[6px] pb-[28px] text-[13px] leading-[1.65] whitespace-pre-wrap text-fg2">{{ file.raw }}</pre>
          <div v-else-if="file.kind === 'source'" class="preview-code pt-[8px] pb-[28px]" v-html="file.html"></div>
          <pre v-else-if="file.kind === 'text'" class="mono break-words pt-[6px] pb-[28px] text-[13px] leading-[1.65] whitespace-pre-wrap text-fg2">{{ file.raw }}</pre>
        </template>
      </div>
    </div>
  </Sheet>
</template>
