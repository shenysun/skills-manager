import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import pkg from '../package.json' with { type: 'json' };

async function waitForDashboard(cli, args, url) {
  const child = spawn(cli, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + 6000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok) return { child, body: await res.json(), output };
      } catch (error) { lastError = error; }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Dashboard did not respond: ${lastError?.message || output}`);
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
}

assert.equal(pkg.name, '@shenysun/skills-manager');
assert.equal(pkg.bin?.['skills-manager'], './dist/cli.js');
const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
assert.equal(pack.status, 0, pack.stderr || pack.stdout);
const files = JSON.parse(pack.stdout)[0].files.map((f) => f.path);
assert(files.some((f) => f.startsWith('dist/dashboard-web/')), 'dashboard assets missing from pack dry run');
assert(files.includes('dist/cli.js'), 'cli build missing from pack dry run');
const temp = mkdtempSync(path.join(os.tmpdir(), 'skills-pack-smoke-'));
let dashboard;
try {
  const tar = spawnSync('npm', ['pack', '--json'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr || tar.stdout);
  const filename = JSON.parse(tar.stdout)[0].filename;
  const install = spawnSync('npm', ['install', '--prefix', temp, path.resolve(filename)], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const cli = path.join(temp, 'node_modules', '.bin', 'skills-manager');
  const home = path.join(temp, 'home');
  const run = spawnSync(cli, ['--home', home, 'doctor'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).skillHome, home);
  const dashboardHome = path.join(temp, 'dashboard-home');
  const port = 4899;
  dashboard = await waitForDashboard(cli, ['--home', dashboardHome, 'dashboard', '--no-open', '--port', String(port)], `http://127.0.0.1:${port}/api/state`);
  assert.equal(dashboard.body.ok, true);
  assert.equal(dashboard.body.data.skillHome, dashboardHome);
  assert.equal(dashboard.body.data.package.info.name, '@shenysun/skills-manager');
  console.log('package smoke test passed');
} finally {
  if (dashboard?.child) dashboard.child.kill('SIGTERM');
  rmSync(temp, { recursive: true, force: true });
}
