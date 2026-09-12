import type { GitPort } from '../../src/core/ports/git.js';

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
  };
}
