import readline from 'node:readline/promises';

/**
 * The plain-http confirmation (spec source-formats, US-12): an http:// URL
 * source downloads only when the user says so — `--yes` on the command line
 * or an interactive y/N. A non-interactive session (agent context, ADR-0014)
 * declines: the core's insecure_http_unconfirmed error then names the remedy.
 */
export async function confirmInsecureHttp(url: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Download ${url} over unencrypted http? [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
