import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { ApiStack } from "../lib/api-stack";

function synthApiTemplate(): Template {
  const app = new cdk.App();
  const stack = new ApiStack(app, "TestApi", {
    env: { account: "111111111111", region: "ap-southeast-1" },
  });
  return Template.fromStack(stack);
}

function assertStageHasNoApiGatewayCacheCluster(template: Template): void {
  const stages = template.findResources("AWS::ApiGateway::Stage");
  const entries = Object.entries(stages);
  if (entries.length === 0) {
    throw new Error("Expected at least one AWS::ApiGateway::Stage resource");
  }
  for (const [logicalId, resource] of entries) {
    const props = resource.Properties ?? {};
    if (props.CacheClusterEnabled === true) {
      throw new Error(
        `Stage ${logicalId} has CacheClusterEnabled=true; expected no cache cluster`,
      );
    }
    if ("CacheClusterSize" in props) {
      throw new Error(
        `Stage ${logicalId} must not set CacheClusterSize when cache cluster is disabled`,
      );
    }
    if ("CacheDataEncrypted" in props) {
      throw new Error(
        `Stage ${logicalId} must not set CacheDataEncrypted when cache cluster is disabled`,
      );
    }
    const methodSettings: unknown[] = props.MethodSettings ?? [];
    for (const entry of methodSettings) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const ms = entry as Record<string, unknown>;
      if ("CachingEnabled" in ms) {
        throw new Error(
          `Stage ${logicalId} MethodSettings must not include CachingEnabled overrides; found ${JSON.stringify(ms)}`,
        );
      }
      if ("CacheTtlInSeconds" in ms) {
        throw new Error(
          `Stage ${logicalId} MethodSettings must not include CacheTtlInSeconds; found ${JSON.stringify(ms)}`,
        );
      }
    }
  }
}

function assertGatewayResponsesHaveNoBodyTemplates(template: Template): void {
  const responses = template.findResources("AWS::ApiGateway::GatewayResponse");
  const entries = Object.entries(responses);
  if (entries.length === 0) {
    throw new Error("Expected at least one AWS::ApiGateway::GatewayResponse resource");
  }
  for (const [logicalId, resource] of entries) {
    const props = resource.Properties ?? {};
    if ("ResponseTemplates" in props && props.ResponseTemplates != null) {
      const rt = props.ResponseTemplates;
      if (typeof rt === "object" && rt !== null && Object.keys(rt as object).length > 0) {
        throw new Error(
          `GatewayResponse ${logicalId} must not set ResponseTemplates (API Gateway only supports simple substitution in gateway response body templates; VTL leaks into JSON bodies). Found ${JSON.stringify(rt)}`,
        );
      }
    }
  }
}

function assertStageHasCheckovCkv120Suppression(template: Template): void {
  const stages = template.findResources("AWS::ApiGateway::Stage");
  const entries = Object.entries(stages);
  if (entries.length === 0) {
    throw new Error("Expected at least one AWS::ApiGateway::Stage resource");
  }
  for (const [logicalId, resource] of entries) {
    const skipUnknown = (resource as { Metadata?: { checkov?: { skip?: unknown } } })
      .Metadata?.checkov?.skip;
    if (!Array.isArray(skipUnknown)) {
      throw new Error(
        `Stage ${logicalId}: expected Metadata.checkov.skip to be an array; got ${JSON.stringify(skipUnknown)}`,
      );
    }
    const ckv120 = skipUnknown.filter(
      (item): item is { id?: unknown; comment?: unknown } =>
        Boolean(item) && typeof item === "object",
    );
    const matches = ckv120.filter((item) => item.id === "CKV_AWS_120");
    if (matches.length !== 1) {
      throw new Error(
        `Stage ${logicalId}: expected exactly one Checkov skip entry with id CKV_AWS_120; found ${matches.length}. Metadata.checkov.skip=${JSON.stringify(skipUnknown)}`,
      );
    }
    const comment = matches[0].comment;
    if (typeof comment !== "string" || comment.trim().length === 0) {
      throw new Error(
        `Stage ${logicalId}: CKV_AWS_120 suppression must include a non-empty comment string`,
      );
    }
  }
}

function assertPollResponsesTableUsesCustomerManagedKms(template: Template): void {
  const tables = template.findResources("AWS::DynamoDB::Table");
  const pollTable = Object.entries(tables).find(([logicalId]) =>
    logicalId.includes("PollResponsesTable"),
  );
  if (!pollTable) {
    throw new Error("Expected PollResponsesTable AWS::DynamoDB::Table resource");
  }
  const [logicalId, resource] = pollTable;
  const sse = (resource.Properties ?? {}).SSESpecification as
    | Record<string, unknown>
    | undefined;
  if (!sse || sse.SSEEnabled !== true) {
    throw new Error(
      `PollResponsesTable ${logicalId}: expected SSESpecification.SSEEnabled=true`,
    );
  }
  if (sse.SSEType !== "KMS") {
    throw new Error(
      `PollResponsesTable ${logicalId}: expected SSESpecification.SSEType=KMS; got ${String(sse.SSEType)}`,
    );
  }
  if (typeof sse.KMSMasterKeyId !== "object" && typeof sse.KMSMasterKeyId !== "string") {
    throw new Error(
      `PollResponsesTable ${logicalId}: expected SSESpecification.KMSMasterKeyId for customer-managed CMK`,
    );
  }
}

function assertPollResponsesTableHasExpiresAtTtl(template: Template): void {
  const tables = template.findResources("AWS::DynamoDB::Table");
  const pollTable = Object.entries(tables).find(([logicalId]) =>
    logicalId.includes("PollResponsesTable"),
  );
  if (!pollTable) {
    throw new Error("Expected PollResponsesTable AWS::DynamoDB::Table resource");
  }
  const [logicalId, resource] = pollTable;
  const ttl = (resource.Properties ?? {}).TimeToLiveSpecification as
    | Record<string, unknown>
    | undefined;
  if (!ttl || ttl.Enabled !== true) {
    throw new Error(
      `PollResponsesTable ${logicalId}: expected TimeToLiveSpecification.Enabled=true`,
    );
  }
  if (ttl.AttributeName !== "expiresAt") {
    throw new Error(
      `PollResponsesTable ${logicalId}: expected TimeToLiveSpecification.AttributeName=expiresAt; got ${String(ttl.AttributeName)}`,
    );
  }
}

function assertCognitoClientAllowlistWiring(template: Template): void {
  // There must be exactly one Cognito app client. JWT validation is fail-closed
  // and the allowlist (COGNITO_ALLOWED_CLIENT_IDS) is wired to this single
  // client's id; a second client would have its tokens silently rejected.
  const clients = template.findResources("AWS::Cognito::UserPoolClient");
  const clientIds = Object.keys(clients);
  if (clientIds.length !== 1) {
    throw new Error(
      `Expected exactly one AWS::Cognito::UserPoolClient; found ${clientIds.length}: ${clientIds.join(", ")}`,
    );
  }
  const [clientLogicalId] = clientIds;

  // Every Lambda that allowlists Cognito client ids must reference that single
  // client via Ref, so the allowlist can never drift to a different client.
  const functions = template.findResources("AWS::Lambda::Function");
  const wired: string[] = [];
  for (const [logicalId, resource] of Object.entries(functions)) {
    const vars = ((resource.Properties ?? {}).Environment ?? {}).Variables ?? {};
    if (!("COGNITO_ALLOWED_CLIENT_IDS" in vars)) {
      continue;
    }
    const value = (vars as Record<string, unknown>).COGNITO_ALLOWED_CLIENT_IDS;
    const ref =
      value && typeof value === "object"
        ? (value as Record<string, unknown>).Ref
        : undefined;
    if (ref !== clientLogicalId) {
      throw new Error(
        `Lambda ${logicalId}: COGNITO_ALLOWED_CLIENT_IDS must reference the single user pool client (${clientLogicalId}); found ${JSON.stringify(value)}`,
      );
    }
    wired.push(logicalId);
  }
  if (wired.length === 0) {
    throw new Error(
      "Expected at least one Lambda to set COGNITO_ALLOWED_CLIENT_IDS (authorizers + API handler)",
    );
  }
}

function assertInboxImportUsesDedicatedPageToken(stack: cdk.Stack): void {
  const template = Template.fromStack(stack);
  const parameters = template.findParameters("MetaPageAccessToken");
  const pageToken = parameters.MetaPageAccessToken;
  if (!pageToken || pageToken.NoEcho !== true) {
    throw new Error(
      "Expected CfnParameter MetaPageAccessToken with NoEcho for Graph inbox import",
    );
  }
  const nested = stack.node.tryFindChild("InboxImport");
  if (!(nested instanceof cdk.NestedStack)) {
    throw new Error("Expected InboxImport nested stack on ApiStack");
  }
  const nestedTemplate = Template.fromStack(nested);
  const functions = nestedTemplate.findResources("AWS::Lambda::Function");
  const match = Object.entries(functions).find(([, resource]) => {
    const name = (resource.Properties ?? {}).FunctionName;
    return name === "evolvesprouts-InboxImportFunction";
  });
  if (!match) {
    throw new Error(
      "Expected Lambda FunctionName evolvesprouts-InboxImportFunction",
    );
  }
  const [, resource] = match;
  const vars = ((resource.Properties ?? {}).Environment ?? {}).Variables ?? {};
  const value = (vars as Record<string, unknown>).META_PAGE_ACCESS_TOKEN;
  const ref =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).Ref
      : undefined;
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error(
      `InboxImportFunction META_PAGE_ACCESS_TOKEN must Ref a nested parameter; found ${JSON.stringify(value)}`,
    );
  }
  const instagramUrl = (vars as Record<string, unknown>)
    .PUBLIC_WWW_INSTAGRAM_URL;
  if (instagramUrl === undefined || instagramUrl === null) {
    throw new Error(
      "InboxImportFunction must set PUBLIC_WWW_INSTAGRAM_URL so Graph import can skip the business Instagram handle",
    );
  }
}

function assertInboxImportHasNoReservedConcurrency(stack: cdk.Stack): void {
  const nested = stack.node.tryFindChild("InboxImport");
  if (!(nested instanceof cdk.NestedStack)) {
    throw new Error("Expected InboxImport nested stack on ApiStack");
  }
  const template = Template.fromStack(nested);
  const functions = template.findResources("AWS::Lambda::Function");
  const match = Object.entries(functions).find(([, resource]) => {
    const name = (resource.Properties ?? {}).FunctionName;
    return name === "evolvesprouts-InboxImportFunction";
  });
  if (!match) {
    throw new Error(
      "Expected Lambda FunctionName evolvesprouts-InboxImportFunction",
    );
  }
  const [logicalId, resource] = match;
  const reserved = (resource.Properties ?? {}).ReservedConcurrentExecutions;
  if (reserved !== undefined) {
    throw new Error(
      `InboxImportFunction ${logicalId} must omit ReservedConcurrentExecutions so the account unreserved pool stays above 100; found ${JSON.stringify(reserved)}`,
    );
  }
}

function assertApiTokenAuthorizerHasNoReservedConcurrency(template: Template): void {
  const functions = template.findResources("AWS::Lambda::Function");
  const match = Object.entries(functions).find(([, resource]) => {
    const name = (resource.Properties ?? {}).FunctionName;
    return name === "evolvesprouts-ApiTokenAuthorizerFunction";
  });
  if (!match) {
    throw new Error(
      "Expected Lambda FunctionName evolvesprouts-ApiTokenAuthorizerFunction",
    );
  }
  const [logicalId, resource] = match;
  const reserved = (resource.Properties ?? {}).ReservedConcurrentExecutions;
  if (reserved !== undefined) {
    throw new Error(
      `ApiTokenAuthorizerFunction ${logicalId} must omit ReservedConcurrentExecutions so the account unreserved pool stays above 100; found ${JSON.stringify(reserved)}`,
    );
  }
}

function main(): void {
  const app = new cdk.App();
  const stack = new ApiStack(app, "TestApi", {
    env: { account: "111111111111", region: "ap-southeast-1" },
  });
  const template = Template.fromStack(stack);
  assertStageHasNoApiGatewayCacheCluster(template);
  assertGatewayResponsesHaveNoBodyTemplates(template);
  assertStageHasCheckovCkv120Suppression(template);
  assertPollResponsesTableUsesCustomerManagedKms(template);
  assertPollResponsesTableHasExpiresAtTtl(template);
  assertCognitoClientAllowlistWiring(template);
  assertApiTokenAuthorizerHasNoReservedConcurrency(template);
  assertInboxImportHasNoReservedConcurrency(stack);
  assertInboxImportUsesDedicatedPageToken(stack);

  console.log("api-stack API Gateway stage cache assertions passed.");
}

try {
  main();
} catch (err) {

  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
