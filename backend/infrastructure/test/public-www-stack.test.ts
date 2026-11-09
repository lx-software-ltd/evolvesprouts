import * as fs from "node:fs";
import * as path from "node:path";

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import {
  MEDIA_REQUEST_PROXY_FUNCTION,
  STATIC_EXPORT_PATH_REWRITE_FUNCTION,
  WWW_PROXY_ALLOWLIST_FUNCTION,
} from "../lib/cloudfront-www-proxy-functions";
import {
  PublicWwwStack,
  viewerRequestSource,
  withEdgeVerify,
} from "../lib/public-www-stack";

const CACHING_DISABLED_MANAGED_ID = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
/** ALL_VIEWER_EXCEPT_HOST_HEADER */
const ORIGIN_REQUEST_POLICY_ALL_VIEWER_EXCEPT_HOST =
  "b689b0a8-53d0-40ab-baf2-68738e2966ac";

function synthPublicWwwTemplate(): Template {
  const app = new cdk.App();
  const stack = new PublicWwwStack(app, "TestPublicWww", {
    env: { account: "111111111111", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

function assertApiProxyCachePolicies(template: Template): void {
  const policies = template.findResources("AWS::CloudFront::CachePolicy");
  const entries = Object.entries(policies);
  if (entries.length !== 2) {
    throw new Error(
      `Expected exactly 2 AWS::CloudFront::CachePolicy resources (prod + staging), found ${entries.length}`,
    );
  }
  for (const [, resource] of entries) {
    const config = resource.Properties?.CachePolicyConfig;
    if (!config) {
      throw new Error("Cache policy missing CachePolicyConfig");
    }
    if (config.DefaultTTL !== 300 || config.MaxTTL !== 900 || config.MinTTL !== 0) {
      throw new Error(
        `Unexpected TTLs on cache policy: ${JSON.stringify({
          DefaultTTL: config.DefaultTTL,
          MaxTTL: config.MaxTTL,
          MinTTL: config.MinTTL,
        })}`,
      );
    }
    const params = config.ParametersInCacheKeyAndForwardedToOrigin;
    if (params?.QueryStringsConfig?.QueryStringBehavior !== "all") {
      throw new Error("Expected QueryStringBehavior=all on API proxy cache policy");
    }
    if (params?.HeadersConfig?.HeaderBehavior !== "none") {
      throw new Error("Expected HeaderBehavior=none on API proxy cache policy");
    }
    if (params?.CookiesConfig?.CookieBehavior !== "none") {
      throw new Error("Expected CookieBehavior=none on API proxy cache policy");
    }
    if (params?.EnableAcceptEncodingGzip !== true) {
      throw new Error("Expected EnableAcceptEncodingGzip=true");
    }
    if (params?.EnableAcceptEncodingBrotli !== true) {
      throw new Error("Expected EnableAcceptEncodingBrotli=true");
    }
  }
}

function findWwwStarBehavior(
  behaviors: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return behaviors.find((b) => b.PathPattern === "www/*");
}

function assertEachDistributionWwwBehaviors(template: Template): void {
  const distributions = template.findResources("AWS::CloudFront::Distribution");
  const entries = Object.entries(distributions);
  if (entries.length !== 2) {
    throw new Error(
      `Expected exactly 2 CloudFront distributions (prod + staging), found ${entries.length}`,
    );
  }
  for (const [logicalId, resource] of entries) {
    const behaviors: Array<Record<string, unknown>> =
      resource.Properties?.DistributionConfig?.CacheBehaviors ?? [];
    const freeRequest = behaviors.find(
      (b) => b.PathPattern === "www/v1/assets/free/request",
    );
    if (!freeRequest) {
      throw new Error(
        `Distribution ${logicalId} missing www/v1/assets/free/request behavior`,
      );
    }
    if (freeRequest.CachePolicyId !== CACHING_DISABLED_MANAGED_ID) {
      throw new Error(
        `Distribution ${logicalId}: free/request must use CACHING_DISABLED managed policy`,
      );
    }
    const wwwStar = findWwwStarBehavior(behaviors);
    if (!wwwStar) {
      throw new Error(`Distribution ${logicalId} missing www/* behavior`);
    }
    if (
      typeof wwwStar.CachePolicyId !== "object" ||
      wwwStar.CachePolicyId === null ||
      !("Ref" in wwwStar.CachePolicyId)
    ) {
      throw new Error(
        `Distribution ${logicalId}: www/* must use Ref to custom ApiProxyCachePolicy`,
      );
    }
    const ref = (wwwStar.CachePolicyId as { Ref: string }).Ref;
    if (!/ApiProxyCachePolicy/.test(ref)) {
      throw new Error(
        `Distribution ${logicalId}: unexpected CachePolicyId Ref ${ref}`,
      );
    }
    const methods = wwwStar.AllowedMethods as string[] | undefined;
    if (!methods?.includes("POST") || !methods?.includes("DELETE")) {
      throw new Error(
        `Distribution ${logicalId}: www/* must allow POST/DELETE (ALLOW_ALL)`,
      );
    }
    if (wwwStar.OriginRequestPolicyId !== ORIGIN_REQUEST_POLICY_ALL_VIEWER_EXCEPT_HOST) {
      throw new Error(
        `Distribution ${logicalId}: www/* must use ALL_VIEWER_EXCEPT_HOST_HEADER origin request policy`,
      );
    }
    const fnAssoc = wwwStar.FunctionAssociations as
      | Array<{ EventType?: string; FunctionARN?: unknown }>
      | undefined;
    if (!Array.isArray(fnAssoc) || fnAssoc.length !== 2) {
      throw new Error(
        `Distribution ${logicalId}: www/* must have exactly two FunctionAssociations`,
      );
    }
    const events = new Set(
      fnAssoc.map((a) => a.EventType).filter((e): e is string => typeof e === "string"),
    );
    if (!events.has("viewer-request") || !events.has("viewer-response")) {
      throw new Error(
        `Distribution ${logicalId}: www/* must associate viewer-request and viewer-response functions`,
      );
    }
  }
}

/**
 * Verify CloudFront Function updates are serialized within each environment.
 *
 * The four functions per environment (``PathRewrite``, ``WwwProxyAllowlist``,
 * ``MediaRequestProxy``, ``WwwApiErrorResponse``) must form a single chain via
 * CloudFormation ``DependsOn`` so CloudFormation cannot schedule parallel
 * updates that exhaust the regional CloudFront Functions API rate limit.
 */
function assertCloudFrontFunctionUpdatesAreSerialized(template: Template): void {
  const fns = template.findResources("AWS::CloudFront::Function");
  const entries = Object.entries(fns);
  if (entries.length !== 8) {
    throw new Error(
      `Expected exactly 8 AWS::CloudFront::Function resources (4 per environment x 2), found ${entries.length}`,
    );
  }
  const expectedEnvKinds = [
    "PathRewriteFunction",
    "WwwProxyAllowlistFunction",
    "MediaRequestProxyFunction",
    "WwwApiErrorResponseFunction",
  ] as const;
  for (const envPrefix of ["PublicWww", "PublicWwwStaging"] as const) {
    const ids = expectedEnvKinds.map((kind) => {
      const id = entries.find(([logicalId]) =>
        logicalId.startsWith(`${envPrefix}${kind}`),
      )?.[0];
      if (!id) {
        throw new Error(
          `Missing CloudFront Function ${envPrefix}${kind} in synthesized template`,
        );
      }
      return id;
    });
    const [pathRewriteId, allowlistId, mediaProxyId, errorResponseId] = ids;
    const dependsOn = (logicalId: string): string[] => {
      const raw = fns[logicalId]?.DependsOn;
      if (raw === undefined || raw === null) {
        return [];
      }
      return Array.isArray(raw) ? (raw as string[]) : [raw as string];
    };
    if (!dependsOn(allowlistId).includes(pathRewriteId)) {
      throw new Error(
        `${envPrefix}: WwwProxyAllowlistFunction must DependsOn PathRewriteFunction`,
      );
    }
    if (!dependsOn(mediaProxyId).includes(allowlistId)) {
      throw new Error(
        `${envPrefix}: MediaRequestProxyFunction must DependsOn WwwProxyAllowlistFunction`,
      );
    }
    if (!dependsOn(errorResponseId).includes(mediaProxyId)) {
      throw new Error(
        `${envPrefix}: WwwApiErrorResponseFunction must DependsOn MediaRequestProxyFunction`,
      );
    }
    // Pathrewrite (chain head) must not depend on any sibling function in this
    // environment so the chain stays single-threaded but doesn't deadlock the
    // first item.
    for (const sibling of [allowlistId, mediaProxyId, errorResponseId]) {
      if (dependsOn(pathRewriteId).includes(sibling)) {
        throw new Error(
          `${envPrefix}: PathRewriteFunction must not DependsOn ${sibling}`,
        );
      }
    }
  }
}

function assertEdgeVerifyParameters(template: Template): void {
  const document = template.toJSON() as {
    Parameters: Record<string, Record<string, unknown>>;
    Conditions: Record<string, unknown>;
  };
  const names = [
    "PublicWwwEdgeVerifySecret",
    "PublicWwwEdgeVerifySecretPrevious",
    "PublicWwwStagingEdgeVerifySecret",
    "PublicWwwStagingEdgeVerifySecretPrevious",
  ];
  for (const name of names) {
    const parameter = document.Parameters[name];
    if (!parameter) {
      throw new Error(`Missing parameter ${name}`);
    }
    if (parameter.NoEcho !== true || parameter.Default !== "") {
      throw new Error(`${name} must be NoEcho with default ""`);
    }
    if (parameter.AllowedPattern !== "^$|^[A-Za-z0-9+/=_-]{32,}$") {
      throw new Error(`${name} has unexpected AllowedPattern`);
    }
  }
  for (const name of [
    "HasPublicWwwEdgeVerifySecret",
    "HasPublicWwwStagingEdgeVerifySecret",
  ]) {
    const rendered = JSON.stringify(document.Conditions[name]);
    if (!rendered.includes("Fn::Not") || !rendered.includes("Fn::And")) {
      throw new Error(`${name} must be NOT (current empty AND previous empty)`);
    }
  }
  if (JSON.stringify(document.Conditions).includes("AttachWaf")) {
    throw new Error(
      "No CloudFront WebACL is attached; do not add the WAF-detach condition",
    );
  }
  const outputs = (
    template.toJSON() as { Outputs?: Record<string, unknown> }
  ).Outputs ?? {};
  for (const name of ["PublicWwwEdgeVerifyEnabled", "PublicWwwStagingEdgeVerifyEnabled"]) {
    const output = outputs[name];
    const conditionName = `Has${name.replace("Enabled", "Secret")}`;
    if (!output || !JSON.stringify(output).includes(conditionName)) {
      throw new Error(`${name} must publish ${conditionName}`);
    }
  }
}

function functionCode(resource: { Properties?: { FunctionCode?: unknown } }): string {
  return JSON.stringify(resource.Properties?.FunctionCode ?? "");
}

function assertEdgeVerifyOnEveryViewerRequest(template: Template): void {
  const functions = template.findResources("AWS::CloudFront::Function");
  const viewerRequestIds = Object.keys(functions).filter(
    (logicalId) => !logicalId.includes("WwwApiErrorResponse"),
  );
  if (viewerRequestIds.length !== 6) {
    throw new Error(
      `Expected 6 viewer-request functions, found ${viewerRequestIds.length}`,
    );
  }
  for (const logicalId of viewerRequestIds) {
    const code = functionCode(functions[logicalId]);
    if (!code.includes("edgeVerifyRejection") || !code.includes("x-proxy-verify")) {
      throw new Error(`${logicalId} is missing the edge-verify check`);
    }
  }
  for (const logicalId of Object.keys(functions)) {
    if (
      logicalId.includes("WwwApiErrorResponse") &&
      functionCode(functions[logicalId]).includes("edgeVerifyRejection")
    ) {
      throw new Error(`${logicalId} must stay a viewer-response function`);
    }
  }

  const distributions = template.findResources("AWS::CloudFront::Distribution");
  for (const [distributionId, resource] of Object.entries(distributions)) {
    const config = resource.Properties?.DistributionConfig as {
      DefaultCacheBehavior?: { FunctionAssociations?: Array<Record<string, unknown>> };
      CacheBehaviors?: Array<{
        PathPattern?: string;
        FunctionAssociations?: Array<Record<string, unknown>>;
      }>;
    };
    const behaviors = [
      { PathPattern: "(default)", ...(config.DefaultCacheBehavior ?? {}) },
      ...(config.CacheBehaviors ?? []),
    ];
    for (const behavior of behaviors) {
      const viewerRequest = (behavior.FunctionAssociations ?? []).filter(
        (association) => association.EventType === "viewer-request",
      );
      if (viewerRequest.length !== 1) {
        throw new Error(
          `${distributionId} ${behavior.PathPattern} must have one viewer-request function`,
        );
      }
      const functionArn = viewerRequest[0].FunctionARN as
        | { "Fn::GetAtt"?: string[] }
        | undefined;
      const logicalId = functionArn?.["Fn::GetAtt"]?.[0];
      if (!logicalId || !functionCode(functions[logicalId]).includes("edgeVerifyRejection")) {
        throw new Error(
          `${distributionId} ${behavior.PathPattern} viewer-request function has no edge-verify check`,
        );
      }
    }
    const webAcl = JSON.stringify(config);
    if (!webAcl.includes("HasWafWebAclArn")) {
      throw new Error(`${distributionId} WebACL override no longer keys off HasWafWebAclArn`);
    }
  }
}

function assertPathRewriteMatchesTrainingCopy(): void {
  const file = fs.readFileSync(
    path.join(__dirname, "../lib/functions/public-www-path-rewrite.js"),
    "utf8",
  );
  const rewriteLines = [
    "if (uri.startsWith('/_next/'))",
    "request.uri = uri + 'index.html';",
    "if (uri.indexOf('.') === -1)",
    "request.uri = uri + '/index.html';",
  ];
  for (const line of rewriteLines) {
    if (!file.includes(line) || !STATIC_EXPORT_PATH_REWRITE_FUNCTION.includes(line)) {
      throw new Error(`Path rewrite drifted from the training copy: ${line}`);
    }
  }
}

function assertEdgeVerifyFunctionBudget(): void {
  const secrets = { current: "x".repeat(64), previous: "y".repeat(64) };
  const pathRewrite = fs.readFileSync(
    path.join(__dirname, "../lib/functions/public-www-path-rewrite.js"),
    "utf8",
  );
  const bodies = [
    withEdgeVerify(pathRewrite, secrets),
    viewerRequestSource(WWW_PROXY_ALLOWLIST_FUNCTION, secrets),
    viewerRequestSource(MEDIA_REQUEST_PROXY_FUNCTION, secrets),
  ];
  for (const body of bodies) {
    const size = Buffer.byteLength(body, "utf8");
    if (size >= 10 * 1024) {
      throw new Error(
        `Viewer-request function is ${size} bytes; CloudFront limit is 10240`,
      );
    }
  }
}

function main(): void {
  const template = synthPublicWwwTemplate();
  assertApiProxyCachePolicies(template);
  assertEachDistributionWwwBehaviors(template);
  assertCloudFrontFunctionUpdatesAreSerialized(template);
  assertEdgeVerifyParameters(template);
  assertEdgeVerifyOnEveryViewerRequest(template);
  assertEdgeVerifyFunctionBudget();
  assertPathRewriteMatchesTrainingCopy();

  console.log(
    "public-www-stack CloudFront cache policy and function-chain assertions passed.",
  );
}

try {
  main();
} catch (err) {

  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
