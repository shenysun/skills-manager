<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Sheet from './Sheet.vue';
import { errorMessage, fetchSkillFile, type SkillFilePayload, type SkillRowState } from '../api/client';
import { renderedView, togglePreviewView, type PreviewView } from '../domain/previewView';

// Read-only skill preview (CONTEXT.md): a wide Sheet over the library. Opened
// with SKILL.md preselected; the rendered view innerHTMLs only server-sanitized
// HTML, the source view shows the raw text that arrived in the same response.
const props = defineProps<{ skill: SkillRowState }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const file = ref<SkillFilePayload | null>(null);
const loadError = ref<string | null>(null);
const view = ref<PreviewView>(renderedView);

onMounted(async () => {
  try {
    file.value = await fetchSkillFile(props.skill.name, 'SKILL.md');
  } catch (error) {
    loadError.value = errorMessage(error);
  }
});
</script>

<template>
  <Sheet wide :title="skill.name" @cancel="emit('close')">
    <template #head>
      <span class="preview-desc">{{ skill.description }}</span>
      <button
        v-if="file?.kind === 'markdown'"
        class="text-btn preview-toggle"
        @click="view = togglePreviewView(view)"
      >
        {{ view === 'rendered' ? t('preview.viewSource') : t('preview.viewRendered') }}
      </button>
    </template>

    <div class="preview-body">
      <p v-if="loadError" class="preview-error">{{ t('preview.loadFailed', { message: loadError }) }}</p>
      <p v-else-if="!file" class="preview-hint">{{ t('preview.loading') }}</p>
      <template v-else>
        <p v-if="file.truncated" class="preview-hint preview-truncated">{{ t('preview.truncated') }}</p>
        <!-- v-html is safe here: the server pipeline sanitizes everything it puts in html. -->
        <div v-if="view === 'rendered'" class="preview-md" v-html="file.html"></div>
        <pre v-else class="preview-source mono">{{ file.raw }}</pre>
      </template>
    </div>
  </Sheet>
</template>
