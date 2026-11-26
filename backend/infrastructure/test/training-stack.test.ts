import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";

import { TrainingStack } from "../lib/training-stack";

const CACHING_DISABLED_MANAGED_ID = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const ORIGIN_REQUEST_POLICY_ALL_VIEWER_EXCEPT_HOST =
  "b689b0a8-53d0-40ab-baf2-68738e2966ac";

function synthTrainingTemplate(): Template {
  const app = new cdk.App();
  const stack = new TrainingStack(app, "TestTraining", {
    env: { account: "111111111111", region: "ap-southeast-1" },
  });
  return Template.fromStack(stack);
}

function assertBucketNamesWithinLimit(template: Template): void {
  const buckets = template.findResources("AWS::S3::Bucket");
  for (const [, resource] of Object.entries(buckets)) {
    const name = resource.Properties?.BucketName;
    if (typeof name !== "string") {
      continue;
    }
    if (name.length > 63) {
      throw new Error(`S3 bucket name exceeds 63 characters: ${name}`);
    }
  }
}

function assertCustomResponseHeaders(template: Template): void {
  const policies = template.findResources("AWS::CloudFront::ResponseHeadersPolicy");
  const entries = Object.values(policies);
  if (entries.length !== 1) {
    throw new Error(
      `Expected exactly 1 ResponseHeadersPolicy, found ${entries.length}`,
    );
  }
  const customHeaders =
    entries[0].Properties?.ResponseHeadersPolicyConfig?.CustomHeadersConfig
      ?.Items ?? [];
  const robotsHeader = customHeaders.find(
    (item: { Header?: string }) => item.Header === "X-Robots-Tag",
  );
  if (!robotsHeader || robotsHeader.Value !== "noindex, nofollow, noarchive") {
    throw new Error("Expected X-Robots-Tag noindex header on training distribution");
  }
  const permissionsHeader = customHeaders.find(
    (item: { Header?: string }) => item.Header === "Permissions-Policy",
  );
  if (!permissionsHeader?.Value) {
    throw new Error("Expected Permissions-Policy header on training distribution");
  }
}

function assertWwwApiBehaviors(template: Template): void {
  template.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      CacheBehaviors: Match.arrayWith([
        Match.objectLike({ PathPattern: "api/v1/public/assets/free/request" }),
        Match.objectLike({ PathPattern: "api/*" }),
      ]),
    }),
  });

  const distributions = template.findResources("AWS::CloudFront::Distribution");
  if (Object.keys(distributions).length !== 1) {
    throw new Error(
      `Expected exactly 1 CloudFront distribution, found ${Object.keys(distributions).length}`,
    );
  }

  const behaviors: Array<Record<string, unknown>> =
    Object.values(distributions)[0].Properties?.DistributionConfig
      ?.CacheBehaviors ?? [];
  if (behaviors.some((b) => String(b.PathPattern ?? "").startsWith("www"))) {
    throw new Error("Training distribution still has a /www behavior");
  }
  const apiStar = behaviors.find((b) => b.PathPattern === "api/*");
  if (!apiStar) {
    throw new Error("Missing api/* cache behavior");
  }
  if (
    typeof apiStar.CachePolicyId !== "object" ||
    apiStar.CachePolicyId === null ||
    !("Ref" in apiStar.CachePolicyId)
  ) {
    throw new Error("api/* must use Ref to TrainingApiProxyCachePolicy");
  }
  const cachePolicyRef = (apiStar.CachePolicyId as { Ref: string }).Ref;
  if (!/TrainingApiProxyCachePolicy/.test(cachePolicyRef)) {
    throw new Error(`Unexpected CachePolicyId Ref: ${cachePolicyRef}`);
  }
  if (
    apiStar.OriginRequestPolicyId !== ORIGIN_REQUEST_POLICY_ALL_VIEWER_EXCEPT_HOST
  ) {
    throw new Error("api/* behavior missing ALL_VIEWER_EXCEPT_HOST_HEADER policy");
  }

  const freeRequest = behaviors.find(
    (b) => b.PathPattern === "api/v1/public/assets/free/request",
  );
  if (freeRequest?.CachePolicyId !== CACHING_DISABLED_MANAGED_ID) {
    throw new Error("media request behavior should disable caching");
  }
}

function main(): void {
  const template = synthTrainingTemplate();
  assertBucketNamesWithinLimit(template);
  assertCustomResponseHeaders(template);
  assertWwwApiBehaviors(template);
  console.log("training-stack.test.ts: ok");
}

main();
