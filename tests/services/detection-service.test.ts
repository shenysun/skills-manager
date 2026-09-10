import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitHubApiPort } from '../../src/core/ports/github-api.js';
import { DetectionService, type DetectionSkillRow } from '../../src/core/services/detection-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';

const GITLAB_URL = 'https://gitlab.com/acme/skills.git';

/** Non-GitHub, non-local row: the only shape that routes through remoteHeadSha. */
function lsRemoteRow(name = 'alpha'): DetectionSkillRow {
  return {
    name,
    source: { type: 'git', url: GITLAB_URL, subpath: 'skills/alpha', ref: 'main', upstream_commit: 'old-head' },
  };
}

function fakeServices(skillNames: string[], homeRoot: string) {
  return {
    update: { plan: () => ({ groups: [{ skills: skillNames.map((skill) => ({ skill })) }] }) },
    registry: { editSafeFields: () => undefined },
    distribute: { fingerprint: () => 'sha256:fingerprint' },
    resolution: { root: homeRoot },
  };
}

const githubApiNever: GitHubApiPort = {
  async fetchRepoTree() {
    throw new Error('non-GitHub rows must never reach the GitHub API');
  },
};

let root: string;
let nowMs: number;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'detection-service-'));
  nowMs = 1_000_000;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('DetectionService remote-head cache (adversary L8/L9)', () => {
  it('does not cache a null head for the TTL — a just-pushed ref is visible on the next request', async () => {
    const answers: Array<string | null> = [null, 'new-head'];
    let calls = 0;
    const detection = new DetectionService({
      githubApi: githubApiNever,
      fs: createNodeFileSystem(),
      now: () => nowMs,
      remoteHead: async () => answers[Math.min(calls++, answers.length - 1)],
    });
    const services = fakeServices(['alpha'], root);
    const skills = [lsRemoteRow()];

    const first = await detection.detect(services, skills);
    nowMs += 1_000; // far inside the 5-minute TTL
    const second = await detection.detect(services, skills);

    expect(calls).toBe(2);
    expect(first.get('alpha')).toEqual({ detection: 'failed', hasUpdate: false });
    expect(second.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
  });

  it('caches a resolved head for the TTL — one ls-remote serves repeat requests', async () => {
    let calls = 0;
    const detection = new DetectionService({
      githubApi: githubApiNever,
      fs: createNodeFileSystem(),
      now: () => nowMs,
      remoteHead: async () => {
        calls += 1;
        return 'new-head';
      },
    });
    const services = fakeServices(['alpha'], root);
    const skills = [lsRemoteRow()];

    const first = await detection.detect(services, skills);
    nowMs += 60_000;
    const second = await detection.detect(services, skills);

    expect(calls).toBe(1);
    expect(first.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
    expect(second.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
  });

  it('shares one in-flight ls-remote between concurrent detections of the same url@ref (L9)', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const detection = new DetectionService({
      githubApi: githubApiNever,
      fs: createNodeFileSystem(),
      now: () => nowMs,
      remoteHead: () => {
        calls += 1;
        return new Promise<string | null>((resolve) => {
          release = () => resolve('new-head');
        });
      },
    });
    const services = fakeServices(['alpha', 'beta'], root);
    const skills = [lsRemoteRow('alpha'), lsRemoteRow('beta')];

    const [first, second] = [detection.detect(services, skills), detection.detect(services, skills)];
    await Promise.resolve();
    release?.();
    const [outcomeA, outcomeB] = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(outcomeA.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
    expect(outcomeB.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
  });
});
