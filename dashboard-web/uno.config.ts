import { defineConfig, presetUno } from 'unocss';

/** Map utilities onto the dashboard token variables so Uno's default greys/blues
 *  cannot replace --bg / --fg / --accent. Class-only (no attributify, no icons). */
export default defineConfig({
  presets: [presetUno()],
  theme: {
    colors: {
      bg: 'var(--bg)',
      fg: 'var(--fg)',
      fg2: 'var(--fg2)',
      fg3: 'var(--fg3)',
      line: 'var(--line)',
      line2: 'var(--line2)',
      accent: 'var(--accent)',
      warn: 'var(--warn)',
      danger: 'var(--danger)',
      ok: 'var(--ok)',
    },
  },
  shortcuts: {
    'sheet-overlay':
      'fixed inset-0 z-[500] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] backdrop-blur-[2px]',
    'log-overlay':
      'fixed inset-0 z-[450] bg-[color-mix(in_srgb,var(--bg)_45%,transparent)]',
    'sheet-place': 'fixed left-1/2 top-[8vh] z-[501] -translate-x-1/2',
    'log-panel':
      'fixed top-0 right-0 bottom-0 z-[451] w-[min(420px,92vw)] overflow-y-auto border-l border-line bg-bg px-[22px] py-[20px] shadow-[-12px_0_32px_rgba(0,0,0,0.12)]',
    sheet:
      'w-[760px] max-w-full rounded-[12px] border border-line bg-bg px-[22px] pt-[20px] pb-[18px] shadow-[0_18px_48px_rgba(0,0,0,0.14)]',
    'sheet-wide':
      'flex h-[calc(92vh-24px)] w-[min(92vw,1080px)] max-w-full flex-col',
    'sheet-head': 'mb-[12px] flex min-w-0 items-baseline gap-[10px]',
    'sheet-title':
      'mr-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-semibold',
    'sheet-close': 'shrink-0 text-[13px] text-fg3 hover:text-fg',
    'sheet-foot': 'mt-[16px] flex items-center gap-[14px] border-t border-line2 pt-[12px]',
    'text-btn': 'text-[13.5px] text-fg2 hover:text-fg',
    'primary-btn':
      'rounded-[8px] bg-accent px-[16px] py-[7px] text-[13.5px] font-semibold text-white disabled:cursor-default disabled:opacity-45',
    'confirm-body': 'text-[14px] leading-[1.6] text-fg2',
    'confirm-skills': 'mt-[8px] text-[13px] text-fg3',
    'scope-row': 'mb-[10px] flex gap-[18px] text-[14px]',
    'scope-tab': 'border-b-2 border-transparent pb-[3px] text-fg2',
    'scope-tab-on': 'border-accent font-semibold text-fg',
    'field-input':
      'mb-[10px] w-full border-none border-b border-line bg-transparent py-[7px] px-[2px] text-[14px] outline-none placeholder:text-fg3',
    'agent-list': 'my-[6px] max-h-[46vh] overflow-y-auto',
    'agent-heading': 'mb-[6px] mt-[12px] text-[12px] font-semibold tracking-[0.08em] text-fg3 uppercase',
    'agent-row': 'flex cursor-pointer items-baseline gap-[10px] px-[2px] py-[5px] text-[13.5px]',
    'agent-id': 'min-w-[130px]',
    'agent-label': 'overflow-hidden text-ellipsis whitespace-nowrap text-fg2',
    'agent-row-invalid': 'cursor-default text-fg3',
    'quick-row': 'mb-[6px] mt-[-4px] flex gap-[14px]',
    'quick-btn': 'p-0 text-[12.5px] text-fg3 hover:text-accent',
    family: 'mb-[4px]',
    'family-all': 'py-[2px] text-[12.5px] text-fg3 hover:text-accent',
    'picker-hint': 'my-[8px] text-[13px] text-fg3',
    'picker-error': 'my-[8px] text-[13px] text-danger',
    'picker-count': 'mr-auto text-[13px] text-fg3',
    'mode-row': 'mt-[10px] flex items-baseline gap-[14px] text-[13.5px]',
    'mode-label': 'text-fg3',
    'mode-tab': 'border-b-2 border-transparent pb-[2px] text-fg2',
    'mode-tab-on': 'border-accent font-semibold text-fg',
    'existing-mark': 'ml-[6px] text-[12px] not-italic text-warn',
    'overwrite-ask': 'mt-[12px] rounded-[10px] border border-line p-[12px] text-[13.5px] text-fg2',
    'overwrite-actions': 'mt-[10px] flex justify-end gap-[14px]',
    'preview-toggle': 'shrink-0 whitespace-nowrap',
  },
});
