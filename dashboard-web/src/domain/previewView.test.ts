import { describe, expect, it } from 'vitest';
import { renderedView, togglePreviewView } from './previewView';

describe('preview view toggle (rendered ⇄ source)', () => {
  it('starts on the rendered view', () => {
    expect(renderedView).toBe('rendered');
  });

  it('toggles rendered → source and back without extra state', () => {
    expect(togglePreviewView('rendered')).toBe('source');
    expect(togglePreviewView('source')).toBe('rendered');
  });

  it('round-trips to the starting view', () => {
    let view = renderedView;
    view = togglePreviewView(view);
    view = togglePreviewView(view);
    expect(view).toBe(renderedView);
  });
});
