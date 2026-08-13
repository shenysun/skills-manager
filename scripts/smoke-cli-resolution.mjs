import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const temp = mkdtempSync(path.join(os.tmpdir(), 'skills-cli-smoke-'));
try {
  const home = path.join(temp, 'home');
  const result = spawnSync(process.execPath, ['dist/cli.js', '--home', home, 'doctor'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const data = JSON.parse(result.stdout);
  assert.equal(data.skillHome, home);
  for (const file of ['skills', 'collections', 'registry.yaml']) {
    const check = spawnSync('test', ['-e', path.join(home, file)]);
    assert.equal(check.status, 0, `${file} was not initialized`);
  }
  const viewsCheck = spawnSync('test', ['-e', path.join(home, 'views')]);
  assert.notEqual(viewsCheck.status, 0, 'views/ should not be required or created');
  const envHome = path.join(temp, 'env-home');
  const envResult = spawnSync(process.execPath, ['dist/cli.js', 'doctor'], { encoding: 'utf8', env: { ...process.env, SKILL_HOME: envHome } });
  assert.equal(envResult.status, 0, envResult.stderr || envResult.stdout);
  assert.equal(JSON.parse(envResult.stdout).skillHome, envHome);
  console.log('cli resolution smoke test passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
