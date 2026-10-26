import { describe, expect, it } from 'vitest';
import {
  loadTriggerFixturesText,
  parseTriggerFixtures,
  renderTriggerFixtures,
  runTriggerFixtures,
} from '../../src/core/services/trigger-fixtures.js';

const hub = [
  { name: 'jest-unit-tests', description: 'Write unit tests with Jest for React components. Use when adding or fixing tests.' },
  { name: 'testing-conventions', description: 'Testing conventions: how to write unit tests with Jest, fixtures and mocks. Use when adding tests.' },
  { name: 'pdf-forms', description: 'Fill and extract PDF form fields.' },
  { name: 'release-notes', description: 'Draft release notes from merged pull requests.' },
];

describe('parseTriggerFixtures / loadTriggerFixturesText', () => {
  it('accepts a bare array and an object with name + fixtures', () => {
    const a = parseTriggerFixtures([
      { request: 'fill PDF form fields', expect: 'pdf-forms' },
      { request: 'draft release notes', expect: 'release-notes', top: 1 },
    ]);
    expect(a.fixtures).toHaveLength(2);
    expect(a.name).toBeUndefined();
    const b = parseTriggerFixtures({
      name: 'hub smoke',
      fixtures: [{ request: 'x', expect: 'pdf-forms' }],
    });
    expect(b.name).toBe('hub smoke');
  });

  it('rejects empty lists, bad shapes, and unknown keys', () => {
    expect(() => parseTriggerFixtures([])).toThrow(/empty/);
    expect(() => parseTriggerFixtures({ fixtures: [{ request: 'a' }] })).toThrow(/expect/);
    expect(() => parseTriggerFixtures([{ request: 'a', expect: 'b', top: 0 }])).toThrow(/≥ 1/);
    expect(() => parseTriggerFixtures([{ request: 'a', expect: 'b', foo: 1 }])).toThrow(/unknown key/);
  });

  it('loads YAML and JSON by extension', () => {
    const yaml = loadTriggerFixturesText(
      'name: demo\nfixtures:\n  - request: fill PDF form fields\n    expect: pdf-forms\n',
      'cases.yaml',
    );
    expect(yaml.name).toBe('demo');
    expect(yaml.fixtures[0].expect).toBe('pdf-forms');
    const json = loadTriggerFixturesText(
      JSON.stringify([{ request: 'draft release notes', expect: 'release-notes', top: 2 }]),
      'cases.json',
    );
    expect(json.fixtures[0].top).toBe(2);
    expect(() => loadTriggerFixturesText('[]', 'cases.txt')).toThrow(/\.yaml/);
  });
});

describe('runTriggerFixtures / render', () => {
  it('runs every case and fails the report when any assertion fails', () => {
    const file = parseTriggerFixtures({
      name: 'ci',
      fixtures: [
        { request: 'fill PDF form fields from a scanned document', expect: 'pdf-forms' },
        { request: 'draft release notes from the merged pull requests', expect: 'release-notes' },
        { request: 'write unit tests with Jest fixtures and mocks', expect: 'testing-conventions', top: 2 },
        { request: 'fill PDF form fields', expect: 'release-notes' }, // intentional miss
      ],
    });
    const report = runTriggerFixtures(file, hub, { filePath: 'ci.yaml' });
    expect(report.total).toBe(4);
    expect(report.passed).toBe(3);
    expect(report.failed).toBe(1);
    expect(report.results[3].ok).toBe(false);
    const text = renderTriggerFixtures(report);
    expect(text).toContain('PASS');
    expect(text).toContain('FAIL');
    expect(text).toContain('3/4');
  });

  it('fails cleanly when --expect skill is missing from the hub', () => {
    const file = parseTriggerFixtures([{ request: 'anything', expect: 'no-such-skill' }]);
    const report = runTriggerFixtures(file, hub, { filePath: 'missing.yaml' });
    expect(report.failed).toBe(1);
    expect(report.results[0].detail).toMatch(/not in hub/);
  });
});
