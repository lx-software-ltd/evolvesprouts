# CloudFront function sources

`public-www-edge-verify.js` and `../test/public-www-edge-verify.test.mjs` are
byte-identical to siutindei. Do not edit them here.

Two sentences in those copies describe siutindei, not this repository:

- The comment in `public-www-edge-verify.js` says the check is prepended to
  every public-website viewer-request function and that Cloudflare adds
  `x-proxy-verify`. Here only the staging distribution's viewer-request
  functions are prepended, and the staging Worker adds the header. Production
  functions do not run the check. `docs/architecture/security.md` is the
  description for this repository.
- The size test is named "largest body" and reads
  `public-www-path-rewrite.js`, which is the smallest of the three staging
  bodies. `test/public-www-stack.test.ts` measures all three, including the
  API allowlist.

`public-www-path-rewrite.js` is a fixture for that copied size test. Nothing
deploys it. Staging builds the path rewrite from
`STATIC_EXPORT_PATH_REWRITE_FUNCTION` in
`cloudfront-www-proxy-functions.ts`. From `function handler` onward, the
fixture must match that wrap.
