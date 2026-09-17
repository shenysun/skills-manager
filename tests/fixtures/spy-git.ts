import type { GitPort } from '../../src/core/ports/git.js';

/** Inert sync plumbing, shared by every GitPort stub: test paths that never
 *  touch the hub-git layer only need the port satisfied. */
export const inertSyncGit = (): Pick<GitPort, 'available' | 'initRepo' | 'remoteUrl' | 'remoteAdd' | 'statusPorcelain' | 'addAll' | 'commit'> => ({
  available: () => true,
  initRepo: () => {},
  remoteUrl: () => null,
  remoteAdd: () => {},
  statusPorcelain: () => '',
  addAll: () => {},
  commit: () => 'sha',
});

/** Inert GitPort: checkout paths under test (archive, malformed zip) never
 *  reach the git transport, so the stub only satisfies the port. */
export function spyGit(): GitPort {
  return {
    clone: () => {},
    revParseHead: () => 'sha',
    revParseTree: () => 'tree',
    listRemoteHeads: () => [],
    statusShort: () => '',
    log: () => [],
    ...inertSyncGit(),
  };
}
