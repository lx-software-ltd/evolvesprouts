/**
 * AssetSharePathRewriteFunction is permanent. A route in a sent email is
 * never removed.
 *
 * Viewer paths from those emails (`/v1/assets/share/...` and
 * `/v1/assets/email-download/...`) rewrite to `/v1/public/assets/...`.
 * A `/prod` prefix, left over from the old API base path, is stripped
 * first. The query string stays on the request.
 */
export const ASSET_SHARE_PATH_REWRITE_FUNCTION = `
function handler(event) {
  var request = event.request;
  var uri = request.uri || '';
  var path = uri;
  if (path.indexOf('/prod/') === 0) {
    path = path.substring(5);
  }
  var sharePrefix = '/v1/assets/share/';
  var emailPrefix = '/v1/assets/email-download/';
  if (path.indexOf(sharePrefix) === 0) {
    request.uri = '/v1/public/assets/share/' + path.substring(sharePrefix.length);
  } else if (path.indexOf(emailPrefix) === 0) {
    request.uri = '/v1/public/assets/email-download/' + path.substring(emailPrefix.length);
  }
  return request;
}
`;
