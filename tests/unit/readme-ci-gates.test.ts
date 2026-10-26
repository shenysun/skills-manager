import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The README CI-gates table must list the same gate commands in EN and zh. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gates = ['audit security --strict', 'provenance list --fail-on-imported', 'cost --budget <tokens>', 'update --check --fail-on-stale'];

function tableCommands(file: string): string[] {
  return readFileSync(path.join(root, file), 'utf8')
    .split('\n')
    .filter((l) => /^\| [^-]/.test(l))
    .map((l) => l.split('|')[2]?.trim().match(/^`(.+)`$/)?.[1])
    .filter((c): c is string => Boolean(c));
}

describe('README CI gates table', () => {
  it.each(['README.md', 'README.zh-CN.md'])('%s lists every gate', (file) => {
    expect(tableCommands(file)).toEqual(expect.arrayContaining(gates));
  });

  it('EN and zh list the same commands', () => {
    expect(tableCommands('README.zh-CN.md')).toEqual(tableCommands('README.md'));
  });
});
