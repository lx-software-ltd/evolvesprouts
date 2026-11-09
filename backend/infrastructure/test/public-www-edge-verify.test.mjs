import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const sourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../lib/functions/public-www-edge-verify.js',
);
const template = fs.readFileSync(sourcePath, 'utf8');
const CURRENT = 'current-secret-value-0123456789abcdefghij';
const PREVIOUS = 'previous-secret-value-0123456789abcdefghi';

function load({ current, previous }) {
  const context = {};
  vm.createContext(context);
  const source = template
    .replace('__EDGE_VERIFY_SECRET__', current)
    .replace('__EDGE_VERIFY_SECRET_PREVIOUS__', previous);
  vm.runInContext(
    `${source}\nglobalThis.edgeVerifyRejection = edgeVerifyRejection;`,
    context,
  );
  return (headers) => context.edgeVerifyRejection({ headers });
}

// CloudFront strips these before any edge function runs, so a header with
// one of these names can never be checked by the function.
// https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html
const CLOUDFRONT_DISALLOWED_HEADER = /^(x-edge-|x-amz-cf-|x-amzn-|x-accel-|x-cache$|x-real-ip$|x-forwarded-proto$)/i;

function headerName() {
  const match = template.match(/var EDGE_VERIFY_HEADER = '([^']+)'/);
  assert.ok(match, 'EDGE_VERIFY_HEADER declaration not found');
  return match[1];
}

test('uses a header name CloudFront exposes to functions', () => {
  const name = headerName();
  assert.equal(name, name.toLowerCase());
  assert.doesNotMatch(name, CLOUDFRONT_DISALLOWED_HEADER);
});

test('uses the same header name Cloudflare sets in the edge policy', () => {
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(
        path.dirname(sourcePath),
        '../../../../scripts/cloudflare/public_www_edge_policy.json',
      ),
      'utf8',
    ),
  );
  const transform = policy.rulesets.http_request_late_transform.rules.find(
    (rule) => rule.description === 'edge-verify-header',
  );
  assert.deepEqual(Object.keys(transform.action_parameters.headers), [headerName()]);
});

test('does nothing when both secrets are empty', () => {
  const check = load({ current: '', previous: '' });
  assert.equal(check({}), null);
  assert.equal(check({ 'x-proxy-verify': { value: 'anything' } }), null);
});

test('accepts the current secret', () => {
  const check = load({ current: CURRENT, previous: '' });
  assert.equal(check({ 'x-proxy-verify': { value: CURRENT } }), null);
});

test('accepts the previous secret during rotation', () => {
  const check = load({ current: CURRENT, previous: PREVIOUS });
  assert.equal(check({ 'x-proxy-verify': { value: PREVIOUS } }), null);
  assert.equal(check({ 'x-proxy-verify': { value: CURRENT } }), null);
});

test('refuses a missing, empty, or wrong header with an uncacheable 403', () => {
  const check = load({ current: CURRENT, previous: '' });
  for (const headers of [
    {},
    undefined,
    { 'x-proxy-verify': { value: '' } },
    { 'x-proxy-verify': { value: `${CURRENT}x` } },
    { 'x-proxy-verify': { value: PREVIOUS } },
  ]) {
    const response = check(headers);
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['cache-control'].value, 'no-store');
  }
});

test('enforces when only the previous secret is set', () => {
  const check = load({ current: '', previous: PREVIOUS });
  assert.equal(check({}).statusCode, 403);
  assert.equal(check({ 'x-proxy-verify': { value: PREVIOUS } }), null);
});

test('stays within the CloudFront Functions size budget with the largest body', () => {
  const pathRewrite = fs.readFileSync(
    path.join(path.dirname(sourcePath), 'public-www-path-rewrite.js'),
    'utf8',
  );
  const combined = `${template
    .replace('__EDGE_VERIFY_SECRET__', 'x'.repeat(64))
    .replace('__EDGE_VERIFY_SECRET_PREVIOUS__', 'y'.repeat(64))}\n${pathRewrite}`;
  assert.ok(Buffer.byteLength(combined, 'utf8') < 10 * 1024);
});
