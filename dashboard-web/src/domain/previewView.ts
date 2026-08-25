/**
 * The preview Sheet's markdown dual view: rendered (server-sanitized HTML) and
 * source (the raw text that came with the same response — switching views
 * never issues another request).
 */
export type PreviewView = 'rendered' | 'source';

export const renderedView: PreviewView = 'rendered';

export function togglePreviewView(view: PreviewView): PreviewView {
  return view === 'rendered' ? 'source' : 'rendered';
}
