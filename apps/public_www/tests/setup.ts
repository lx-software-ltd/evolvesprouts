import '@testing-library/jest-dom/vitest';

process.env.NEXT_PUBLIC_EMAIL = process.env.NEXT_PUBLIC_EMAIL ?? 'tests@example.com';

// Vitest uses jsdom with a localhost origin. CI or local `.env*` may set
// `NEXT_PUBLIC_WWW_PROXY_ALLOWED_HOSTS` (e.g. including `localhost`), which makes
// `buildCrmApiUrl` rewrite `https://api…` to relative `/api/...` and breaks
// tests that assert absolute URLs. Proxy rewrite behavior is covered in
// `tests/lib/crm-api-client.test.ts`, which stubs these env vars in `beforeEach`.
process.env.NEXT_PUBLIC_WWW_PROXY_ALLOWED_HOSTS = '';

// CI injects `NEXT_PUBLIC_SITE_ORIGIN` from production params. If it shares the
// same registrable domain as URLs used in assertions (e.g. example.com),
// `isSameRootDomainHttpHref` treats those links as first-party and SmartLink uses
// `rel="noopener"` instead of `noopener noreferrer`. Tests stub env when needed.
process.env.NEXT_PUBLIC_SITE_ORIGIN = '';
process.env.NEXT_PUBLIC_INTERNAL_LINK_ROOT_DOMAIN = '';
