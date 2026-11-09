// Staging gate shared by siutindei and evolvesprouts. Keep this file
// byte-identical in both repositories; only the bindings differ.
//
// Bindings:
//   PRODUCTION_ORIGIN                       required, e.g. https://siutindei.com
//   STAGING_ALLOWED_IPS                     comma or whitespace separated IPs
//   STAGING_BYPASS_SECRET                   optional; CI sends it as x-staging-bypass
//   PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET   optional; forwarded as x-proxy-verify
//                                           for the CloudFront origin lock

const BYPASS_HEADER = 'x-staging-bypass';
const EDGE_VERIFY_HEADER = 'x-proxy-verify';

export function parseAllowedIps(raw) {
  return new Set(
    String(raw ?? '')
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAllowed(request, env) {
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  if (ip && parseAllowedIps(env.STAGING_ALLOWED_IPS).has(ip)) {
    return true;
  }
  const secret = env.STAGING_BYPASS_SECRET ?? '';
  return secret.length > 0 && constantTimeEquals(request.headers.get(BYPASS_HEADER) ?? '', secret);
}

export async function handle(request, env, fetchImpl = fetch) {
  const productionOrigin = (env.PRODUCTION_ORIGIN ?? '').trim();
  if (!productionOrigin) {
    return new Response('Staging gate is not configured.', { status: 503 });
  }

  if (!isAllowed(request, env)) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, productionOrigin);
    return Response.redirect(target.toString(), 302);
  }

  const headers = new Headers(request.headers);
  headers.delete(BYPASS_HEADER);
  headers.delete(EDGE_VERIFY_HEADER);
  const edgeSecret = env.PUBLIC_WWW_STAGING_EDGE_VERIFY_SECRET ?? '';
  if (edgeSecret) {
    headers.set(EDGE_VERIFY_HEADER, edgeSecret);
  }
  return fetchImpl(new Request(request, { headers }));
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
