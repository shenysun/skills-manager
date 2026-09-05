# Dashboard view layer: Reka UI + UnoCSS

The Dashboard UI keeps its ratified look (typographic flow, light/dark Theme) but the view layer is rewritten: **Reka UI** for interaction primitives, **UnoCSS** for almost all styling. A full component kit is rejected because this app is small and the visual baseline is frozen.

**Decision**

- Vue 3 stays. Core services, CLI, and the Fastify dashboard HTTP adapter are untouched.
- Headless primitives come from `reka-ui` (Radix Vue's successor). Not Naive / Element Plus / Ant Design Vue; not Headless UI; not a second copy-paste kit (shadcn-vue) on top.
- Styling is UnoCSS at **page** scope. `page.css` / `sheet.css` go away. `tokens.css` remains as the CSS-variable source (Uno theme maps onto `--bg`, `--fg`, `--accent`, …). The Shiki dual-theme rules in `preview.css` stay — utilities cannot express them.
- Every interactive control that has a Reka primitive is replaced: Sheet and LogDrawer → Dialog; RowMenu → DropdownMenu; ProjectDropdown → Combobox; native checkboxes → Checkbox; the notice toast → Toast. Product names (Sheet, 日志 drawer, Theme toggle) do not change.
- Toast **semantics** stay as ratified 2026-08-27: one bottom-center slot, ~4 s, a new notice replaces the previous, no stack. If Reka Toast wants a list, wrap it until it matches.
- Nested-dialog body scroll lock and `scrollbar-gutter: stable` stay (CONTEXT §Dialog scroll lock).
- Rewrite boundary is the **view layer only**: new `App.vue`, `components/`, and styles. Keep `domain/` and its tests, `api/client.ts`, i18n catalogues, and Theme/locale *behaviour* (OS default until a manual toggle persists).
- Visual lock: implement against the live dashboard; `designs/skills-manager-dashboard/` (variant C) is the tie-breaker if live and baseline disagree. No screenshot suite, no extra prototype.

**Considered options**

- Full UI kit — rejected: unused surface, look would drift.
- Headless UI Vue — rejected: thinner primitive set; worse fit without Tailwind.
- Keep hand-rolled Sheet/Menu and only add Uno — rejected: the a11y gaps (no focus trap, fake menus) are why a library was hired.
- Tailwind instead of Uno — rejected: operator chose UnoCSS.
- Hybrid CSS (keep `page.css`, Uno only on new wrappers) — rejected: two style sources for agents to guess between.
- Incremental edit of current Vue files, or a third rewrite of `domain/` / the HTTP client — rejected: the pain is the view/styling stack, not the already-tested domain.

**Consequences**

- `dashboard-web` gains `reka-ui` and UnoCSS (Vite plugin). The published package still ships the Vite-built dashboard; no new runtime for the CLI.
- A future agent must not “fix” the dashboard by adding Element/Naive or a Settings page for Theme.
