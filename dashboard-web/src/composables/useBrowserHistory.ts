import { ref, computed } from 'vue';

const STORAGE_KEY = 'sm:browser-history';
const MAX_HISTORY = 10;

type BrowserHistory = {
  paths: string[];
};

function loadHistory(): BrowserHistory {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : { paths: [] };
  } catch {
    return { paths: [] };
  }
}

function saveHistory(history: BrowserHistory) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Silently fail if localStorage is not available
  }
}

export function useBrowserHistory() {
  const history = ref<BrowserHistory>(loadHistory());

  const recentPaths = computed(() => history.value.paths);

  function addPath(path: string) {
    if (!path || path.trim() === '') return;

    const cleaned = path.trim();
    const existing = history.value.paths.filter((p) => p !== cleaned);
    const updated = [cleaned, ...existing].slice(0, MAX_HISTORY);

    history.value = { paths: updated };
    saveHistory(history.value);
  }

  return {
    recentPaths,
    addPath,
  };
}
