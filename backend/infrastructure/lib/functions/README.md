# CloudFront function sources

`public-www-edge-verify.js` and `../test/public-www-edge-verify.test.mjs` are
byte-identical to siutindei. Do not edit them here.

One sentence in the copied function describes siutindei, not this repository:

- The comment in `public-www-edge-verify.js` says Cloudflare adds
  `x-proxy-verify`. Staging's Worker adds the header. Production's header
  comes from the late-transform rule in
  `scripts/cloudflare/public_www_edge_policy.json`, applied in the Cloudflare
  dashboard. `docs/architecture/security.md` is the description for this
  repository.
- The size test is named "largest body" and reads
  `public-www-path-rewrite.js`, which is the smallest of the three
  public-website bodies. Both distributions deploy those bodies.
  `test/public-www-stack.test.ts` measures all three, including the
  API allowlist.

`public-www-path-rewrite.js` is a fixture for that copied size test. Nothing
deploys it. Both public website distributions build the path rewrite from
`STATIC_EXPORT_PATH_REWRITE_FUNCTION` in
`cloudfront-www-proxy-functions.ts`. From `function handler` onward, the
fixture must match that wrap.
