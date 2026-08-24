import { execSync } from 'node:child_process';

/** CLI-seam tests run the built dist/cli.js; keep it fresh before the suite. */
export default function setup() {
  execSync('npm run build:cli', { stdio: 'inherit' });
}
