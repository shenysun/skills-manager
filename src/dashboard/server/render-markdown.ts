import MarkdownIt from 'markdown-it';
import DOMPurify from 'isomorphic-dompurify';
import { createHighlighter, type Highlighter } from 'shiki';

// Server-side render pipeline (spec §Rendering Pipeline): markdown-it renders
// with inline HTML allowed, Shiki highlights fenced code, DOMPurify sanitizes
// the output — skill bodies are untrusted third-party input, so nothing
// reaches the html field unsanitized.

/** Language whitelist (spec): fence aliases in, shiki grammar ids out. */
const HIGHLIGHT_LANGS = [
  'markdown', 'javascript', 'typescript', 'python', 'vue', 'shellscript',
  'json', 'yaml', 'toml', 'html', 'css', 'xml', 'sql',
] as const;

const FENCE_ALIASES: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python', md: 'markdown',
  sh: 'shellscript', bash: 'shellscript', shell: 'shellscript', zsh: 'shellscript',
  yml: 'yaml', 'c++': 'cpp',
};

function resolveLang(fence: string): string | null {
  const normalized = fence.trim().toLowerCase();
  const candidate = FENCE_ALIASES[normalized] ?? normalized;
  return (HIGHLIGHT_LANGS as readonly string[]).includes(candidate) ? candidate : null;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: [...HIGHLIGHT_LANGS],
  });
  return highlighterPromise;
}

// markdown-it's highlight callback is synchronous, so the highlighter is
// awaited in renderMarkdown and handed over through a module-local slot.
let activeHighlighter: Highlighter | null = null;

const md = new MarkdownIt({
  html: true,
  highlight(code, fence) {
    const lang = resolveLang(fence);
    if (!activeHighlighter || lang === null) return ''; // markdown-it default escape
    // defaultColor false: one DOM, both palettes as CSS variables — the client
    // switches themes purely via CSS, no re-render, no second request.
    return activeHighlighter.codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  },
});

// Same leading YAML block shape parseSkillMarkdownMetadata recognizes
// (src/shared/validation.ts); the preview renders the body after it.
const FRONTMATTER = /^---\s*\n[\s\S]*?\n---\s*\n?/;

/** Drop the leading `---` YAML block — the rendered view starts at the body. */
export function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER, '');
}

export async function renderMarkdown(body: string): Promise<string> {
  activeHighlighter = await getHighlighter();
  try {
    return DOMPurify.sanitize(md.render(body));
  } finally {
    activeHighlighter = null;
  }
}

/** Standalone source file highlight (preview `source` kind): same dual-theme
 *  CSS-variable output, sanitized like everything entering an html field. */
export async function highlightSource(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  return DOMPurify.sanitize(highlighter.codeToHtml(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  }));
}
