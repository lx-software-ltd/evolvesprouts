// edgeVerifyRejection comes from public-www-edge-verify.js, which the stack
// prepends to this file. Training keeps its own copy of the rewrite in
// cloudfront-www-proxy-functions.ts and does not run this check.
function handler(event) {
  var request = event.request;
  var rejection = edgeVerifyRejection(request);
  if (rejection) {
    return rejection;
  }
  var uri = request.uri;

  // Never rewrite Next.js static asset requests.
  if (uri.startsWith('/_next/')) {
    return request;
  }

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
  }

  if (uri.indexOf('.') === -1) {
    request.uri = uri + '/index.html';
  }

  return request;
}
