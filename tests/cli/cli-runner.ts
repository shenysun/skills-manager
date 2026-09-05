import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const cli = path.resolve(import.meta.dirname, '..', '..', 'dist', 'cli.js');

/**
 * Hermetic env for CLI child processes: an isolated HOME/user-home, and agent
 * detection probes unset so the detected set never depends on the host session.
 */
export function cliEnv(userHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: userHome,
    SKILLS_MANAGER_USER_HOME: userHome,
    CLAUDECODE: undefined,
    CLAUDE_CODE: undefined,
    CURSOR_AGENT: undefined,
    CODEX_SANDBOX: undefined,
    CODEX_CI: undefined,
    CODEX_THREAD_ID: undefined,
    GEMINI_CLI: undefined,
    ANTIGRAVITY_AGENT: undefined,
    REPL_ID: undefined,
    XDG_CONFIG_HOME: undefined,
  };
}

/** Run the built CLI against a test hub, returning raw spawn output. */
export function runCli(home: string, userHome: string, args: string[]) {
  return spawnSync(process.execPath, [cli, '--home', home, ...args], { encoding: 'utf8', env: cliEnv(userHome) });
}
