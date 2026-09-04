import { describe, expect, it } from 'vitest';
import { detectTheme, nextTheme, persistTheme, themeOnSystemChange, THEME_KEY } from './themePref';

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe('Theme detect / persist / follow OS until toggle', () => {
  it('follows the OS when nothing is saved', () => {
    const store = memoryStore();
    expect(detectTheme(store, 'light')).toBe('light');
    expect(detectTheme(store, 'dark')).toBe('dark');
  });

  it('ignores junk in storage and still follows the OS', () => {
    const store = memoryStore({ [THEME_KEY]: 'sepia' });
    expect(detectTheme(store, 'dark')).toBe('dark');
  });

  it('after toggle, the saved Theme wins over the OS', () => {
    const store = memoryStore();
    const chosen = nextTheme(detectTheme(store, 'dark'));
    persistTheme(store, chosen);
    expect(chosen).toBe('light');
    expect(detectTheme(store, 'dark')).toBe('light');
    expect(detectTheme(store, 'light')).toBe('light');
  });

  it('keeps following a live OS change while the operator has never toggled', () => {
    const store = memoryStore();
    expect(themeOnSystemChange(store, 'dark')).toBe('dark');
    expect(themeOnSystemChange(store, 'light')).toBe('light');
  });

  it('stops following the OS once a Theme has been persisted', () => {
    const store = memoryStore();
    persistTheme(store, 'light');
    expect(themeOnSystemChange(store, 'dark')).toBeNull();
    expect(detectTheme(store, 'dark')).toBe('light');
  });
});
