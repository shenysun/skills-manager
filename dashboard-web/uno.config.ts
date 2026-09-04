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
});
