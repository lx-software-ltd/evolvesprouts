/**
 * Shared CloudFront Function (JS 2.0) sources for static-export sites that
 * proxy allowlisted /www/* public API routes. Used by public-www-stack and
 * training-stack; keep in sync with docs/architecture/security.md.
 */

/** Rewrite extensionless paths to index.html for Next.js static export. */
export const STATIC_EXPORT_PATH_REWRITE_FUNCTION = `
function handler(event) {
  var request = event.request;
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
`;

/** Default-deny allowlist for /www/* API proxy (viewer path includes /www prefix). */
export const WWW_PROXY_ALLOWLIST_FUNCTION = `
function handler(event) {
  var request = event.request;
  var method = request.method || '';
  var uri = request.uri || '';

  var allowlist = {
    'GET': {
      '/www/v1/calendar/public': true,
      '/www/v1/calendar/availability': true,
      '/www/v1/assets/free': true
    },
    'POST': {
      '/www/v1/discounts/validate': true,
      '/www/v1/reservations': true,
      '/www/v1/reservations/payment-intent': true,
      '/www/v1/contact-us': true
    }
  };
  if (allowlist[method] && allowlist[method][uri]) {
    request.uri = uri.substring(4);
    return request;
  }

  var isFormAnswersPath =
    uri.indexOf('/www/v1/forms/') === 0 &&
    uri.lastIndexOf('/answers') === uri.length - 8;
  if (
    (method === 'PUT' || method === 'OPTIONS') &&
    isFormAnswersPath
  ) {
    request.uri = uri.substring(4);
    return request;
  }

  var isFormContactContextPath =
    uri.indexOf('/www/v1/forms/') === 0 &&
    uri.lastIndexOf('/contact-context') === uri.length - 16;
  if (
    (method === 'GET' || method === 'OPTIONS') &&
    isFormContactContextPath
  ) {
    request.uri = uri.substring(4);
    return request;
  }

  var isPollAnswersPath =
    uri.indexOf('/www/v1/polls/') === 0 &&
    uri.lastIndexOf('/answers') === uri.length - 8;
  if (
    (method === 'GET' || method === 'PUT' || method === 'OPTIONS') &&
    isPollAnswersPath
  ) {
    request.uri = uri.substring(4);
    return request;
  }

  var isPollQuestionResultsPath =
    uri.indexOf('/www/v1/polls/') === 0 &&
    uri.indexOf('/questions/') > 0 &&
    uri.lastIndexOf('/results') === uri.length - 8;
  if (
    (method === 'GET' || method === 'OPTIONS') &&
    isPollQuestionResultsPath
  ) {
    request.uri = uri.substring(4);
    return request;
  }

  var isPollControlPath =
    uri.indexOf('/www/v1/polls/') === 0 &&
    uri.lastIndexOf('/control') === uri.length - 8;
  if (
    (method === 'GET' || method === 'PUT' || method === 'OPTIONS') &&
    isPollControlPath
  ) {
    request.uri = uri.substring(4);
    return request;
  }

  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: {
      'content-type': { value: 'application/json; charset=utf-8' },
      'cache-control': { value: 'no-store' }
    },
    body: '{"message":"Forbidden"}'
  };
}
`;

/** Dedicated behavior for POST/OPTIONS /www/v1/assets/free/request → execute-api. */
export const MEDIA_REQUEST_PROXY_FUNCTION = `
function handler(event) {
  var request = event.request;
  var method = request.method || '';
  var uri = request.uri || '';
  var isAllowedMethod = method === 'POST' || method === 'OPTIONS';

  if (uri === '/www/v1/assets/free/request' && isAllowedMethod) {
    request.uri = '/v1/assets/free/request';
    return request;
  }

  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: {
      'content-type': { value: 'application/json; charset=utf-8' },
      'cache-control': { value: 'no-store' }
    },
    body: '{"message":"Forbidden"}'
  };
}
`;

/** Convert HTML error pages from API origins to JSON for /www proxy behaviors. */
export const WWW_API_ERROR_RESPONSE_FUNCTION = `
function handler(event) {
  var response = event.response;
  var statusCode = parseInt(response.statusCode, 10);
  if (statusCode < 400 || statusCode >= 600) {
    return response;
  }
  var ct = response.headers['content-type'];
  var contentType = (ct && ct.value) ? ct.value : '';
  if (contentType.indexOf('text/html') !== -1) {
    response.statusCode = 502;
    response.statusDescription = 'Bad Gateway';
    response.headers['content-type'] = { value: 'application/json; charset=utf-8' };
    response.headers['cache-control'] = { value: 'no-store' };
    response.body = '{"error":"The request could not be processed. Please try again."}';
  }
  return response;
}
`;
