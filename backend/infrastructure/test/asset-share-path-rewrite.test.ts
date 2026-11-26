import { runInNewContext } from "node:vm";

import { ASSET_SHARE_PATH_REWRITE_FUNCTION } from "../lib/asset-share-path-rewrite";

type QueryString = Record<string, { value: string }>;

type RewriteResult = {
  uri: string;
  querystring: QueryString;
};

function rewrite(uri: string, querystring: QueryString): RewriteResult {
  const request = { uri, querystring };
  const context = { event: { request } };
  runInNewContext(
    `${ASSET_SHARE_PATH_REWRITE_FUNCTION}\nhandler(event);`,
    context,
  );
  return context.event.request;
}

function assertRewrite(
  uri: string,
  expectedUri: string,
  querystring: QueryString = { token: { value: "keep-me" } },
): void {
  const result = rewrite(uri, querystring);
  if (result.uri !== expectedUri) {
    throw new Error(`${uri} rewritten to ${result.uri}, expected ${expectedUri}`);
  }
  if (result.querystring !== querystring) {
    throw new Error(`${uri} replaced the query string`);
  }
}

const cases: Array<[string, string]> = [
  ["/v1/assets/share/tok123", "/v1/public/assets/share/tok123"],
  ["/prod/v1/assets/share/tok123", "/v1/public/assets/share/tok123"],
  [
    "/v1/assets/email-download/tok123",
    "/v1/public/assets/email-download/tok123",
  ],
  [
    "/prod/v1/assets/email-download/tok123",
    "/v1/public/assets/email-download/tok123",
  ],
  [
    "/v1/assets/share/tok123/extra",
    "/v1/public/assets/share/tok123/extra",
  ],
  [
    "/prod/v1/assets/email-download/tok123/file.pdf",
    "/v1/public/assets/email-download/tok123/file.pdf",
  ],
];

for (const [uri, expected] of cases) {
  assertRewrite(uri, expected);
  assertRewrite(uri, expected, {});
}

const untouched = rewrite("/v1/public/assets/share/tok123", { q: { value: "1" } });
if (untouched.uri !== "/v1/public/assets/share/tok123") {
  throw new Error(`public path was rewritten to ${untouched.uri}`);
}
if (untouched.querystring.q.value !== "1") {
  throw new Error("query string value changed on an untouched path");
}

if (!ASSET_SHARE_PATH_REWRITE_FUNCTION.includes("function handler(event)")) {
  throw new Error("rewrite function must export a CloudFront handler");
}

console.log("asset-share-path-rewrite.test.ts: ok");
