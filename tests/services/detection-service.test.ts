import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitHubApiPort } from '../../src/core/ports/github-api.js';
import type { HttpDownloadPort } from '../../src/core/ports/http-download.js';
import { SkillsManagerError } from '../../src/shared/errors.js';
import { DetectionService, detectionLogPath, type DetectionSkillRow } from '../../src/core/services/detection-service.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { skillMarkdown } from '../fixtures/archives.js';
import { fakeHttp, type FakeHttpRoutes } from '../fixtures/fake-http.js';

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

/** A url-source row must never fall through to the ls-remote fallback. */
const remoteHeadNever = async () => {
  throw new Error('url rows must never reach ls-remote');
};

describe('DetectionService url sources — ETag pre-check, content-hash verdict (source-formats ticket 05, ADR-0016)', () => {
  let serving: { body: string; headers: Record<string, string> };

  beforeEach(() => {
    serving = { body: skillMarkdown('alpha', 'a url skill'), headers: { etag: '"v1"', lastModified: 'Wed, 09 Sep 2026 10:00:00 GMT' } };
  });

  function urlServices() {
    const routes: FakeHttpRoutes = () => [{ kind: 'bytes', body: serving.body, headers: serving.headers }];
    const http = fakeHttp(routes);
    const s = createCoreServices({
      skillHomeRoot: path.join(root, 'home'),
      projectRoot: root,
      fs: createNodeFileSystem(),
      git: {
        clone: () => {},
        revParseHead: () => 'sha',
        revParseTree: () => 'tree',
        listRemoteHeads: () => [],
        statusShort: () => '',
        log: () => [],
      } as never,
      processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
      tempRoot: path.join(root, 'tmp'),
      userHome: path.join(root, 'user'),
      env: {},
      catalogSnapshot: fixtureSnapshot(),
      http,
    });
    s.skillHome.ensure();
    const detection = new DetectionService({ githubApi: githubApiNever, fs: createNodeFileSystem(), remoteHead: remoteHeadNever, http });
    const bundle = { ...s, resolution: { root: path.join(root, 'home') } };
    return { s, detection, bundle, http };
  }

  function detectUrl(detection: DetectionService, bundle: ReturnType<typeof urlServices>['bundle']) {
    return detection.detect(bundle, bundle.registry.listSkills({ includeArchived: false }));
  }

  /** The payload traffic this describe's assertions talk about — well-known
   *  probe candidates that every url checkout now spends before the payload
   *  are ticket-07 behavior and excluded here (covered in wellknown-source). */
  function payloadCalls(http: { calls: string[] }): string[] {
    return http.calls.filter((call) => !call.includes('.well-known'));
  }

  function installUrl(s: ReturnType<typeof urlServices>['s']) {
    s.install.installFromSourceSelection({ source: 'https://example.com/SKILL.md', selectors: ['alpha'] });
  }

  it('ETag unchanged since install — the probe alone decides, no payload download, no update', async () => {
    const { s, detection, bundle, http } = urlServices();
    installUrl(s);

    const outcomes = await detectUrl(detection, bundle);

    expect(outcomes.get('alpha')).toEqual({ detection: 'ok', hasUpdate: false });
    expect(payloadCalls(http)).toEqual(['GET https://example.com/SKILL.md', 'HEAD https://example.com/SKILL.md']);
  });

  it('a refused probe is not a verdict — detection falls through to the full download (HEAD-405 servers)', async () => {
    const { s, detection, bundle, http } = urlServices();
    installUrl(s);
    serving.body = skillMarkdown('alpha', 'a url skill, renewed');
    serving.headers = { etag: '"v2"' };
    const refusedHead: HttpDownloadPort = {
      download: (url, request) => http.download(url, request),
      probe: () => {
        throw new SkillsManagerError('download_failed', 'HEAD https://example.com/SKILL.md failed with HTTP 405');
      },
    };
    const headless = new DetectionService({ githubApi: githubApiNever, fs: createNodeFileSystem(), remoteHead: remoteHeadNever, http: refusedHead });

    const outcomes = await detectUrl(headless, bundle);

    // The full download decided on the content hash; had the URL been dead the
    // download's own failure would keep the failed visibility.
    expect(outcomes.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
    expect(payloadCalls(http)).toEqual(['GET https://example.com/SKILL.md', 'GET https://example.com/SKILL.md']);
  });

  it('ETag changed and content changed — re-download, content hash flags the update, validators hold until an install', async () => {
    const { s, detection, bundle, http } = urlServices();
    installUrl(s);
    serving.body = skillMarkdown('alpha', 'a url skill, renewed');
    serving.headers = { etag: '"v2"', lastModified: 'Thu, 10 Sep 2026 10:00:00 GMT' };

    const outcomes = await detectUrl(detection, bundle);

    expect(outcomes.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
    expect(payloadCalls(http)).toEqual(['GET https://example.com/SKILL.md', 'HEAD https://example.com/SKILL.md', 'GET https://example.com/SKILL.md']);
    // The stale signal must survive later checks (the ETag is a pre-check, never
    // an anchor): the row keeps the installed validators until an install moves
    // the content, so the next probe still reports "changed" instead of silently
    // skipping to upToDate.
    expect(s.registry.load().skills.alpha?.source?.upstream_etag).toBe('"v1"');
    http.calls.length = 0;
    const again = await detectUrl(detection, bundle);
    expect(again.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
  });

  it('ETag changed but content identical — the hash verdict wins: no update', async () => {
    const { s, detection, bundle } = urlServices();
    installUrl(s);
    serving.headers = { etag: '"rotated"' };

    const outcomes = await detectUrl(detection, bundle);

    expect(outcomes.get('alpha')).toEqual({ detection: 'ok', hasUpdate: false });
  });

  it('a legacy row without the content-sha anchor adopts it on its first no-update re-check — and the registry write lands the mirror with it (ADR-0017)', async () => {
    const { s, detection, bundle } = urlServices();
    // Pre-mirror era row: hub skill + registry.yaml written by hand — going
    // through ensureEntry would already reproject the mirror, so the row is
    // laid down exactly as a pre-ADR-0017 install left it (no mirror, no anchor).
    const dir = path.join(root, 'home', 'skills', 'alpha');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), skillMarkdown('alpha', 'a url skill'));
    writeFileSync(path.join(root, 'home', 'registry.yaml'), [
      'skills:',
      '  alpha:',
      '    path: skills/alpha',
      '    title: alpha',
      '    category: experimental',
      '    tags: []',
      '    consumers: []',
      "    source: {type: url, url: 'https://example.com/SKILL.md', subpath: skills/alpha, ref: null, upstream_commit: null, upstream_tree: null, upstream_etag: '\"v1\"', upstream_last_modified: null}",
      '    update_policy: manual',
      '    description: a url skill',
      '',
    ].join('\n'));
    serving.headers = { etag: '"rotated"' };

    const outcomes = await detectUrl(detection, bundle);

    expect(outcomes.get('alpha')).toEqual({ detection: 'ok', hasUpdate: false });
    const source = s.registry.load().skills.alpha?.source;
    expect(source?.upstream_content_sha).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The calibration is itself a write point: the mirror appears in the same motion.
    expect(readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toContain('skills-manager-content-sha:');
  });

  it('server sends no validators — every round re-downloads and compares the hash', async () => {
    const { s, detection, bundle, http } = urlServices();
    installUrl(s);
    serving.headers = {};

    const outcomes = await detectUrl(detection, bundle);

    expect(outcomes.get('alpha')).toEqual({ detection: 'ok', hasUpdate: false });
    expect(payloadCalls(http).filter((call) => call.startsWith('GET'))).toHaveLength(2);
  });

  it('Last-Modified only — unchanged skips the download, changed re-downloads and compares', async () => {
    const { s, detection, bundle, http } = urlServices();
    serving.headers = { lastModified: 'Wed, 09 Sep 2026 10:00:00 GMT' };
    installUrl(s);
    const unchanged = await detectUrl(detection, bundle);
    expect(unchanged.get('alpha')).toEqual({ detection: 'ok', hasUpdate: false });
    expect(payloadCalls(http).filter((call) => call.startsWith('GET'))).toHaveLength(1);

    serving.headers = { lastModified: 'Fri, 11 Sep 2026 10:00:00 GMT' };
    const changed = await detectUrl(detection, bundle);
    expect(changed.get('alpha')).toEqual({ detection: 'ok', hasUpdate: false });
    expect(payloadCalls(http).filter((call) => call.startsWith('GET'))).toHaveLength(2);
  });

  it('a failed probe is a failed row with a detection-log line, never silence (AC6)', async () => {
    const routes: FakeHttpRoutes = () => [{ kind: 'connect-timeout' }];
    const http = fakeHttp(routes);
    const s = createCoreServices({
      skillHomeRoot: path.join(root, 'home'),
      projectRoot: root,
      fs: createNodeFileSystem(),
      git: { clone: () => {}, revParseHead: () => 'sha', revParseTree: () => 'tree', listRemoteHeads: () => [], statusShort: () => '', log: () => [] } as never,
      processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
      tempRoot: path.join(root, 'tmp'),
      userHome: path.join(root, 'user'),
      env: {},
      catalogSnapshot: fixtureSnapshot(),
      http,
    });
    s.skillHome.ensure();
    writeUpstreamSkillManually(s);
    const bundle = { ...s, resolution: { root: path.join(root, 'home') } };
    const detection = new DetectionService({ githubApi: githubApiNever, fs: createNodeFileSystem(), remoteHead: remoteHeadNever, http });

    const outcomes = await detection.detect(bundle, s.registry.listSkills({ includeArchived: false }));

    expect(outcomes.get('alpha')).toEqual({ detection: 'failed', hasUpdate: false });
    const log = readFileSync(detectionLogPath(path.join(root, 'home')), 'utf8');
    expect(log).toContain('"kind":"url"');
    expect(log).toContain('timed out');
    expect(log).toContain('https://example.com/SKILL.md');
  });
});

/** Seed a url-source registry row + hub skill without a successful download,
 *  for the failure-visibility case. */
function writeUpstreamSkillManually(s: ReturnType<typeof createCoreServices>) {
  const dir = path.join(root, 'home', 'skills', 'alpha');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), skillMarkdown('alpha', 'a url skill'));
  s.registry.ensureEntry('alpha', {
    title: 'alpha',
    description: 'a url skill',
    source: { type: 'url', url: 'https://example.com/SKILL.md', subpath: 'skills/alpha', ref: null, upstream_commit: null, upstream_tree: null, upstream_etag: '"v1"', upstream_last_modified: null },
  });
}
