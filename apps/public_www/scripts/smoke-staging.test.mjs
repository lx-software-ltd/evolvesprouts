import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  STAGING_BYPASS_HEADER,
  nextSameHostUrl,
  resolveBypassHeaders,
} from './smoke-staging.mjs';

const STAGING_ORIGIN = 'https://www-staging.example.com';
const SECRET = 'staging-bypass-secret';

afterEach(() => {
  delete process.env.SMOKE_BASE_URL;
  delete process.env.STAGING_BYPASS_SECRET;
});

describe('resolveBypassHeaders', () => {
  it('sends the bypass header only to the staging host', () => {
    process.env.SMOKE_BASE_URL = STAGING_ORIGIN;
    process.env.STAGING_BYPASS_SECRET = SECRET;

    assert.deepEqual(resolveBypassHeaders(`${STAGING_ORIGIN}/sitemap.xml`), {
      [STAGING_BYPASS_HEADER]: SECRET,
    });
    assert.deepEqual(
      resolveBypassHeaders('https://abc.execute-api.ap-southeast-1.amazonaws.com/prod/v1/health'),
      {},
    );
    assert.deepEqual(resolveBypassHeaders('https://www.example.com/'), {});
  });

  it('omits the header when the secret is unset', () => {
    process.env.SMOKE_BASE_URL = STAGING_ORIGIN;

    assert.deepEqual(resolveBypassHeaders(`${STAGING_ORIGIN}/`), {});
  });
});

describe('nextSameHostUrl', () => {
  it('follows a redirect that stays on the requested host', () => {
    assert.equal(
      nextSameHostUrl(`${STAGING_ORIGIN}/about`, 302, '/about-us'),
      `${STAGING_ORIGIN}/about-us`,
    );
  });

  it('rejects a redirect to another host before that host is requested', () => {
    assert.throws(
      () => nextSameHostUrl(`${STAGING_ORIGIN}/`, 302, 'https://www.example.com/'),
      /redirected off www-staging\.example\.com to https:\/\/www\.example\.com\//,
    );
  });

  it('names the missing secret when the gate redirects', () => {
    delete process.env.STAGING_BYPASS_SECRET;

    assert.throws(
      () => nextSameHostUrl(`${STAGING_ORIGIN}/`, 302, 'https://www.example.com/'),
      /STAGING_BYPASS_SECRET is unset/,
    );
  });

  it('ignores responses that are not redirects', () => {
    assert.equal(nextSameHostUrl(`${STAGING_ORIGIN}/`, 200, null), null);
    assert.equal(nextSameHostUrl(`${STAGING_ORIGIN}/`, 304, '/other'), null);
  });
});
