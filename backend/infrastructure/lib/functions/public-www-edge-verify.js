// Prepended to every viewer-request function on a public website
// distribution. The stack replaces the two placeholders with the
// environment's edge-verify parameters. Cloudflare adds the header on the
// way in (scripts/cloudflare/public_www_edge_policy.json), so a request
// that reaches CloudFront without it did not come through Cloudflare.
// Both placeholders empty disables the check.
//
// The header name must stay outside CloudFront's disallowed set, which is
// stripped before any edge function runs: X-Edge-*, X-Amz-Cf-*, X-Amzn-*,
// X-Accel-*, X-Cache, X-Real-IP, X-Forwarded-Proto. A disallowed name makes
// every request look unauthenticated and takes the site down.
var EDGE_VERIFY_HEADER = 'x-proxy-verify';
var EDGE_VERIFY_SECRETS = [
  '__EDGE_VERIFY_SECRET__',
  '__EDGE_VERIFY_SECRET_PREVIOUS__',
];

function edgeVerifyRejection(request) {
  var header = request.headers && request.headers[EDGE_VERIFY_HEADER];
  var presented = header && header.value ? String(header.value) : '';
  var enforced = false;
  var index;
  for (index = 0; index < EDGE_VERIFY_SECRETS.length; index += 1) {
    var secret = EDGE_VERIFY_SECRETS[index];
    if (!secret) {
      continue;
    }
    enforced = true;
    if (presented === secret) {
      return null;
    }
  }
  if (!enforced) {
    return null;
  }
  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: {
      'cache-control': { value: 'no-store' },
    },
  };
}
