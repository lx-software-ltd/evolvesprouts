import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  constantTimeEquals,
  handle,
  parseAllowedIps,
} from './www-staging-redirect-allowlist.js';

const ENV = {
  PRODUCTION_ORIGIN: 'https://prod.example',
  STAGING_ALLOWED_IPS: '198.51.100.7, 203.0.113.9\n192.0.2.1',
  STAGING_BYPASS_SECRET: 'bypass-secret-value',
  PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET: 'edge-secret-value',
};

function request(headers = {}, url = 'https://staging.example/en/search/?q=swim') {
  return new Request(url, { headers });
}

function recordingFetch() {
  const calls = [];
  const fetchImpl = async (req) => {
    calls.push(req);
    return new Response('origin', { status: 200 });
  };
  return { calls, fetchImpl };
}

test('parseAllowedIps accepts commas, spaces, and newlines', () => {
  assert.deepEqual([...parseAllowedIps(ENV.STAGING_ALLOWED_IPS)], [
    '198.51.100.7',
    '203.0.113.9',
    '192.0.2.1',
  ]);
  assert.equal(parseAllowedIps(undefined).size, 0);
});

test('constantTimeEquals compares exactly', () => {
  assert.equal(constantTimeEquals('abc', 'abc'), true);
  assert.equal(constantTimeEquals('abc', 'abd'), false);
  assert.equal(constantTimeEquals('abc', 'abcd'), false);
  assert.equal(constantTimeEquals('', undefined), false);
});

test('unlisted visitors are redirected to production with path and query', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const response = await handle(request({ 'cf-connecting-ip': '192.0.2.200' }), ENV, fetchImpl);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://prod.example/en/search/?q=swim');
  assert.equal(calls.length, 0);
});

test('a missing client IP is redirected', async () => {
  const { fetchImpl } = recordingFetch();
  const response = await handle(request(), ENV, fetchImpl);
  assert.equal(response.status, 302);
});

test('allow-listed IPs reach the origin with the edge header', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const response = await handle(
    request({ 'cf-connecting-ip': '203.0.113.9', 'x-proxy-verify': 'spoofed' }),
    ENV,
    fetchImpl,
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('x-proxy-verify'), 'edge-secret-value');
  assert.equal(calls[0].url, 'https://staging.example/en/search/?q=swim');
});

test('the bypass header lets CI through and is not forwarded', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const response = await handle(
    request({ 'cf-connecting-ip': '192.0.2.200', 'x-staging-bypass': 'bypass-secret-value' }),
    ENV,
    fetchImpl,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].headers.get('x-staging-bypass'), null);
});

test('a wrong bypass value is redirected', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const response = await handle(
    request({ 'cf-connecting-ip': '192.0.2.200', 'x-staging-bypass': 'bypass-secret-valuX' }),
    ENV,
    fetchImpl,
  );
  assert.equal(response.status, 302);
  assert.equal(calls.length, 0);
});

test('an empty bypass secret never matches an empty header', async () => {
  const { fetchImpl } = recordingFetch();
  const response = await handle(
    request({ 'cf-connecting-ip': '192.0.2.200', 'x-staging-bypass': '' }),
    { ...ENV, STAGING_BYPASS_SECRET: '' },
    fetchImpl,
  );
  assert.equal(response.status, 302);
});

test('without an edge secret no x-proxy-verify header is sent', async () => {
  const { calls, fetchImpl } = recordingFetch();
  await handle(
    request({ 'cf-connecting-ip': '198.51.100.7', 'x-proxy-verify': 'spoofed' }),
    { ...ENV, PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET: '' },
    fetchImpl,
  );
  assert.equal(calls[0].headers.get('x-proxy-verify'), null);
});

test('a missing production origin fails closed', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const response = await handle(
    request({ 'cf-connecting-ip': '198.51.100.7' }),
    { ...ENV, PRODUCTION_ORIGIN: '' },
    fetchImpl,
  );
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});

test('the default export exposes fetch', () => {
  assert.equal(typeof worker.fetch, 'function');
});
