import path from 'node:path';
import type { FileSystemPort } from '../../core/ports/filesystem.js';

export type DetectionFailureEntry = {
  /** Source identity: `owner/repo@ref`, a git URL (with `@ref` when pinned), or a local path. */
  source: string;
  /** Every skill row whose detection this failure covers (a GitHub group fans out to its members). */
  skills: string[];
  /** Failure category — GitHubApiFailureKind for API sources, else the detection path (`ls_remote` / `local`). */
  kind: string;
  message: string;
};

/** Hub-side dashboard log (ADR-0013): `<home>/.skills/dashboard.log`, one JSON
 *  line per detection failure. Append-only, low-frequency, never rotated and
 *  never read back — it exists so "the web update never finished" has a trace.
 *  A logging failure must not break /api/state: it lands on stderr instead. */
export function appendDetectionFailure(fs: FileSystemPort, homeRoot: string, entry: DetectionFailureEntry): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    source: entry.source,
    skills: entry.skills,
    error: { kind: entry.kind, message: entry.message },
  });
  try {
    fs.appendText(path.join(homeRoot, '.skills', 'dashboard.log'), `${line}\n`);
  } catch (error) {
    console.error(`[dashboard] failed to append detection log for ${entry.source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
