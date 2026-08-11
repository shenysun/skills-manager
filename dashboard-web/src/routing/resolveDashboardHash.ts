export const DASHBOARD_SURFACES = ['overview', 'installed', 'sources', 'registry', 'activity'] as const;

export type DashboardSurface = (typeof DASHBOARD_SURFACES)[number];
export type SourcesTab = 'library' | 'discover';

export type ResolvedDashboardRoute = {
  surface: DashboardSurface;
  sourcesTab: SourcesTab | null;
  /** When set, the shell should replace the location hash with this value. */
  redirectHash: string | null;
};

function stripHash(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('#')) value = value.slice(1);
  if (value.startsWith('/')) value = value.slice(1);
  return value;
}

function isSurface(value: string): value is DashboardSurface {
  return (DASHBOARD_SURFACES as readonly string[]).includes(value);
}

/**
 * Resolve a dashboard location hash into a first-class surface, optional Sources tab,
 * and optional replace-redirect for legacy bookmarks.
 */
export function resolveDashboardHash(rawHash: string): ResolvedDashboardRoute {
  const stripped = stripHash(rawHash);
  const queryIndex = stripped.indexOf('?');
  const pathPart = queryIndex >= 0 ? stripped.slice(0, queryIndex) : stripped;
  const query = new URLSearchParams(queryIndex >= 0 ? stripped.slice(queryIndex + 1) : '');
  const segments = pathPart.split('/').filter(Boolean);
  const head = (segments[0] || 'overview').toLowerCase();

  if (head === 'discover') {
    return {
      surface: 'sources',
      sourcesTab: 'discover',
      redirectHash: '#/sources?tab=discover',
    };
  }

  if (head === 'updates') {
    return {
      surface: 'installed',
      sourcesTab: null,
      redirectHash: '#/installed',
    };
  }

  if (head === 'settings') {
    return {
      surface: 'activity',
      sourcesTab: null,
      redirectHash: '#/activity',
    };
  }

  if (head === 'sources') {
    const pathTab = segments[1]?.toLowerCase();
    const queryTab = (query.get('tab') || '').toLowerCase();
    const wantsDiscover = pathTab === 'discover' || queryTab === 'discover';
    const sourcesTab: SourcesTab = wantsDiscover ? 'discover' : 'library';

    // Normalize path form to the canonical query deep-link.
    if (pathTab === 'discover') {
      return {
        surface: 'sources',
        sourcesTab: 'discover',
        redirectHash: '#/sources?tab=discover',
      };
    }

    if (pathTab === 'library') {
      return {
        surface: 'sources',
        sourcesTab: 'library',
        redirectHash: '#/sources',
      };
    }

    return {
      surface: 'sources',
      sourcesTab,
      redirectHash: null,
    };
  }

  if (isSurface(head)) {
    return {
      surface: head,
      sourcesTab: null,
      redirectHash: null,
    };
  }

  return {
    surface: 'overview',
    sourcesTab: null,
    redirectHash: head === 'overview' ? null : '#/overview',
  };
}

export function sourcesTabFromHash(rawHash: string): SourcesTab {
  const resolved = resolveDashboardHash(rawHash);
  if (resolved.surface !== 'sources') return 'library';
  return resolved.sourcesTab || 'library';
}
