import { Worker } from 'node:worker_threads';

/**
 * Wire-real local HTTP servers for transport-adapter tests. The server runs on
 * a worker thread on purpose: the download port's contract is synchronous
 * (GitPort precedent), so the adapter under test blocks the test thread with
 * spawnSync — a server on that thread's event loop could never answer the
 * download child. A worker owns an independent event loop on its own thread,
 * so the TCP exchange the tests observe is the real wire behavior.
 */

export type WireScenario =
  | { kind: 'file'; body: string | Buffer; contentType?: string }
  | { kind: 'chain'; routes: Record<string, { status: number; location?: string }>; body: string }
  | { kind: 'loop-redirect' }
  | { kind: 'downgrade' }
  | { kind: 'status'; status: number }
  | { kind: 'silent' }
  | { kind: 'drip'; ticks: number; everyMs: number }
  | { kind: 'blob'; size: number };

/** A throwaway self-signed certificate for 127.0.0.1 (test asset only). */
const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCr/qD/mwlVlwbV
7YGG4ZKuoi4gWls0VFASs0z7n487WFtJzceoPaIFZ9qi17+Ne7+3Sga/9UZRJIgA
SSy5J3CNc2JRi0EpXk/VvF5zkultDzZUJK/RuwQ20e6yMo8kg0jlXDxYeA3fabIo
+ceU5arhwIHIC1ZdsysG5Dkq9QA9CiHIz7IYe0XX5Uhcy6uc68XxL5ExwBa+tqTq
lFUnoyS37eMWIFE3zrMNfmUVPs2BYai/vXb1K2QFSgB4qY+X9ixaWuWWRStsEJNq
/JjeE5rBLhdDTJd9OHE89ubeTvuVyD55NtTo0nxq0wNopvYooRcgC0ztO9vpU00r
xVe5M4sBAgMBAAECggEALMmvzx/mPF2JsCea9S7EbalZ7Z7Z5TSXbWc3gsa4G7IU
g5GMjmkOSe4TZxhbj1JMSESEoXQTjYm/yKNFfCmjC5KiZa2nmEgw7e2RgvMcygOO
GDc9eZYDsOrWB51W3SE62E8+f6MzqZvygu0YZdOwvfzNTvR01w2TBMZlhKQsHbia
KHjd+gwA7GQMrRi8QDT06rnYeOTGc1bCZgvxjHQL/eJmgPWEVWLNI6cmi7uj81Qe
0MEACMr0vqhWs1poD083O3iJQ6UxvwCnFAWqDbbO6oFTAW9VnlU711YxIJ67Fi07
mRQskqxXNa6FsKDXxAHMT9eGxflzYs/6UEmEtu74yQKBgQDhPezz1RpfwupcCFc1
XRJGUicyYj0HQXWfUpBLjax+6HwgUw8A50ni3e6hG6HphSUqlWwVVrneHSHcqZRf
8uLrM/rJ7h+OTPfuI32TWlzHcn/IaznlEdmZTPQV9xEib38ft5OGQHIqR7NMBP6b
ZQ01gPM9Sk9+0JMM/zcsHXL8ewKBgQDDe0UM4e9cGcQI9r127ODU+rRwaQJdhUay
La+9gzLadqKRHqGCjY3dnpdxXlqfaweRkB1Y86HFmurjGdvsNNoIvMZXS+LuJtSh
uqEpZ7156gX6jzHxPzIrTV/IXuscAjB+GG9KWtbq0BWs5tCUiJJoD+acI69Z0pZ4
304K9dmzswKBgDqPjh6rBitlkucQqBPQueKck2JPFkzfoQQmRCvQjsuECFmjHqB+
gcBBMTyj4YnEOzCCHtLBdJuh+V7UnCYCEStTnV2I0p19t2wrwAdilAKq6zwhXLEI
3gk0b7WSQdsxH90QLoPWF5iUgbI/Di86q5+Agj0qJ9bxxXm4lRCcK3wnAoGAXrb5
i/ZkzZFGZLl4r4iynz8h8l1O4hVTXb25Ku/I0gUtW3cl9mWz2S+gXTPEYP2w2xyi
u5jAR0h6irLa1iX9hsJAr8d7Gr0BxaLxt2gmbE2xu+dp4WQnYMfKowEqlZWR/WbF
dZdyDq/n8LCdW3qYxYb+y6SWr8TTV5mK7NCWPPUCgYEA180+npDavFBOyK49f6JK
KNXslQCty7vJ1jpKoO5V/kZq6SDpYd+voX+YGTWcF90MGKLMBSjuzFapvjMAPeK0
g9Wxr87Hydo9SSRL73H7dNx6YrPXNBy0RDwBU9HIJheP36R4V9lrkleGeUw2aU70
NS1QGAc8zq8Nceefh8jL0ho=
-----END PRIVATE KEY-----`;

export const TEST_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIUPZFnersxwr3fmiTBhDAfwiaatVgwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDkxMjEyMzEzMFoXDTM2MDkw
OTEyMzEzMFowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAq/6g/5sJVZcG1e2BhuGSrqIuIFpbNFRQErNM+5+PO1hb
Sc3HqD2iBWfaote/jXu/t0oGv/VGUSSIAEksuSdwjXNiUYtBKV5P1bxec5LpbQ82
VCSv0bsENtHusjKPJINI5Vw8WHgN32myKPnHlOWq4cCByAtWXbMrBuQ5KvUAPQoh
yM+yGHtF1+VIXMurnOvF8S+RMcAWvrak6pRVJ6Mkt+3jFiBRN86zDX5lFT7NgWGo
v7129StkBUoAeKmPl/YsWlrllkUrbBCTavyY3hOawS4XQ0yXfThxPPbm3k77lcg+
eTbU6NJ8atMDaKb2KKEXIAtM7Tvb6VNNK8VXuTOLAQIDAQABo2QwYjAdBgNVHQ4E
FgQUXe3RqiCbtcRPqqfo3ifEVoVyODYwHwYDVR0jBBgwFoAUXe3RqiCbtcRPqqfo
3ifEVoVyODYwDwYDVR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMA0GCSqG
SIb3DQEBCwUAA4IBAQAxXI2yrR7Y+hjKIdncZxFRxVhDpLgXCjVpfcLZZaR9zly/
Sncj7S5E6IkMudgx1F8156U+tUTk0cBVmsUmBC6PskrvOa9Om22IHABk7z4x3JXI
wjhA626nhm2KS+bZtqqWCOTW5tnYTFUlrK2pjozXhislbq+ezreNb+ulPIgY5VwJ
2Ooi+xzg29MnCNKYD3wdC4tYPjkAWLfj48oCCgGxCvIDK+4jAugIxz18Pf1v5nvY
Eo6sf28Rqms/UMG/NMYmSjRJhDr/ATyIdF6XwktzyDTJo+6uWeRAOXDAKFtivWo4
VNjBnJtBqwf7aQVyH21uBFGoX5hM9Zw9W55CG9E6
-----END CERTIFICATE-----`;

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const http = require('node:http');
const https = require('node:https');
const scenario = workerData.scenario;
const lib = workerData.tls ? https : http;
const server = lib.createServer(workerData.tls ? { key: workerData.tls.key, cert: workerData.tls.cert } : {}, (request, response) => {
  if (scenario.kind === 'file') {
    response.writeHead(200, {
      'content-type': scenario.contentType ?? 'text/markdown',
      etag: '"v1"',
      'last-modified': 'Wed, 09 Sep 2026 10:00:00 GMT',
    });
    response.end(scenario.body);
    return;
  }
  if (scenario.kind === 'chain') {
    const route = scenario.routes[request.url];
    if (route) {
      response.writeHead(route.status, route.location ? { location: route.location } : {});
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/markdown' });
    response.end(scenario.body);
    return;
  }
  if (scenario.kind === 'loop-redirect') {
    const hop = Number((request.url || '/0').slice(1));
    response.writeHead(302, { location: '/' + (hop + 1) });
    response.end();
    return;
  }
  if (scenario.kind === 'downgrade') {
    response.writeHead(302, { location: 'http://127.0.0.1:1/SKILL.md' });
    response.end();
    return;
  }
  if (scenario.kind === 'status') {
    response.writeHead(scenario.status, { 'content-type': 'text/plain' });
    response.end('gone');
    return;
  }
  if (scenario.kind === 'silent') {
    return;
  }
  if (scenario.kind === 'drip') {
    response.writeHead(200, { 'content-type': 'text/markdown' });
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      if (sent >= scenario.ticks) {
        clearInterval(timer);
        response.end();
      } else {
        response.write('x');
      }
    }, scenario.everyMs);
    return;
  }
  if (scenario.kind === 'blob') {
    response.writeHead(200, { 'content-type': 'application/zip' });
    response.end(Buffer.alloc(scenario.size, 1));
    return;
  }
  response.writeHead(500, { 'content-type': 'text/plain' });
  response.end('unknown scenario');
});
server.listen(0, '127.0.0.1', () => {
  parentPort.postMessage({ port: server.address().port });
});
`;

const workers: Worker[] = [];

/** Start one scenario server; resolves to its base URL once it is listening.
 *  `tls` serves the same scenarios over https with the throwaway test
 *  certificate (exported as TEST_CA_PEM for the client's `ca`). */
export async function serveWire(scenario: WireScenario, options: { tls?: boolean } = {}): Promise<string> {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { scenario, tls: options.tls ? { key: TEST_KEY_PEM, cert: TEST_CA_PEM } : undefined },
  });
  workers.push(worker);
  const port = await new Promise<number>((resolve, reject) => {
    worker.once('message', (message: { port?: number }) => {
      if (typeof message.port === 'number') resolve(message.port);
      else reject(new Error('the wire server reported no port'));
    });
    worker.once('error', reject);
  });
  return `${options.tls ? 'https' : 'http'}://127.0.0.1:${port}`;
}

export async function closeWireServers(): Promise<void> {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
}
