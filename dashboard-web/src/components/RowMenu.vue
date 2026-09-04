<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui';

defineEmits<{
  preview: [];
  undistribute: [];
  remove: [];
}>();

const open = defineModel<boolean>({ default: false });
const { t } = useI18n();
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger class="px-[4px] text-fg3 hover:text-fg" :aria-label="t('menu.more')">
      ⋮
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="z-[601] min-w-[180px] rounded-[10px] border border-line bg-bg p-[6px] shadow-[0_10px_28px_rgba(0,0,0,0.14)]"
        :side-offset="4"
        align="end"
      >
        <DropdownMenuItem
          class="cursor-pointer rounded-[6px] px-[12px] py-[7px] text-[13.5px] text-fg outline-none data-[highlighted]:bg-line2"
          @select="$emit('preview')"
        >
          {{ t('menu.preview') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer rounded-[6px] px-[12px] py-[7px] text-[13.5px] text-fg outline-none data-[highlighted]:bg-line2"
          @select="$emit('undistribute')"
        >
          {{ t('menu.undistribute') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          class="cursor-pointer rounded-[6px] px-[12px] py-[7px] text-[13.5px] text-fg outline-none data-[highlighted]:bg-line2"
          @select="$emit('remove')"
        >
          {{ t('menu.remove') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
