// Fixture read by public-www-edge-verify.test.mjs. Not deployed.
// Staging deploys insertEdgeVerifyCall(STATIC_EXPORT_PATH_REWRITE_FUNCTION).
// From "function handler" onward this file must match that result.

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
