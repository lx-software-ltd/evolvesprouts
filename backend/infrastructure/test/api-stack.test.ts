import { readFileSync } from "node:fs";
import path from "node:path";

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { ApiStack } from "../lib/api-stack";
import { assertApiStackInvariants } from "./stack-invariants.test";

// The REST API is regional, so its custom-domain certificate must live in the
// stack region. A us-east-1 ARN is only valid for CloudFront and Cognito.
const API_STACK_REGION = "ap-southeast-1";
const API_CERTIFICATE_SECRET_PLACEHOLDER =
  "<FROM_GITHUB_SECRET: CDK_PARAM_API_CUSTOM_DOMAIN_CERTIFICATE_ARN>";

function assertProductionApiCustomDomain(): void {
  const paramsPath = path.join(__dirname, "../params/production.json");
  const params = JSON.parse(readFileSync(paramsPath, "utf8")) as Record<
    string,
    string
  >;
  const domainName = params.ApiCustomDomainName ?? "";
  if (!domainName) {
    return;
  }
  const publicApex = (params.PublicWwwDomainName ?? "").replace(/^www\./, "");
  if (!publicApex || !domainName.endsWith(`.${publicApex}`)) {
    throw new Error(
      `ApiCustomDomainName must be a host under ${publicApex}. Found ${domainName}`,
    );
  }
  const arn = params.ApiCustomDomainCertificateArn ?? "";
  // Deploy substitutes the secret before CDK runs. A committed literal ARN
  // must be an ACM certificate in the API stack region.
  if (
    arn !== API_CERTIFICATE_SECRET_PLACEHOLDER &&
    !arn.startsWith(`arn:aws:acm:${API_STACK_REGION}:`)
  ) {
    throw new Error(
      `ApiCustomDomainCertificateArn must be an ACM certificate in ${API_STACK_REGION}. Found ${arn}`,
    );
  }
}

function synthApiTemplate(): Template {
  const app = new cdk.App();
  const stack = new ApiStack(app, "TestApi", {
    env: { account: "111111111111", region: "ap-southeast-1" },
  });
  return Template.fromStack(stack);
}

const DELIVERY_LOGS_PRINCIPAL = "delivery.logs.amazonaws.com";

function containsExactString(value: unknown, expected: string): boolean {
  if (typeof value === "string") {
    // Quoted JSON fragments from Fn::Join are split on the quote so a
    // principal must match a whole token, not a substring of a host.
    return value.split('"').some((part) => part === expected);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsExactString(item, expected));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) =>
      containsExactString(item, expected),
    );
  }
  return false;
}

function assertApiGatewayCloudWatchLogging(template: Template): void {
  const accounts = template.findResources("AWS::ApiGateway::Account");
  const accountEntries = Object.entries(accounts);
  if (accountEntries.length !== 1) {
    throw new Error(
      `Expected one AWS::ApiGateway::Account, found ${accountEntries.length}`,
    );
  }
  const [logicalId, resource] = accountEntries[0];
  if (logicalId !== "EvolvesproutsApiAccountE7DF9A66") {
    throw new Error(
      `Expected the RestApi account logical id EvolvesproutsApiAccountE7DF9A66, found ${logicalId}`,
    );
  }
  const roleArn = resource.Properties?.CloudWatchRoleArn as
    | { "Fn::GetAtt"?: [string, string] }
    | undefined;
  const roleRef = roleArn?.["Fn::GetAtt"];
  if (
    roleRef?.[0] !== "EvolvesproutsApiCloudWatchRole00972F46" ||
    roleRef?.[1] !== "Arn"
  ) {
    throw new Error(
      `${logicalId} CloudWatch role logical id is ${roleRef?.[0] ?? "missing"}`,
    );
  }

  const policies = template.findResources("AWS::Logs::ResourcePolicy");
  if (Object.keys(policies).length !== 0) {
    throw new Error(
      "REST API logs use the account role, so the stack must not add a log resource policy",
    );
  }

  const keys = template.findResources("AWS::KMS::Key");
  const logKey = Object.values(keys).find(
    (key) =>
      key.Properties?.Description ===
      "KMS key for API Gateway CloudWatch log encryption",
  );
  if (
    logKey !== undefined &&
    containsExactString(logKey.Properties ?? {}, DELIVERY_LOGS_PRINCIPAL)
  ) {
    throw new Error(
      "ApiLogEncryptionKey must not grant the delivery logs service",
    );
  }

  const customResources = template.findResources("Custom::AWS");
  const accountUpdate = Object.entries(customResources).find(([, item]) => {
    const rendered = JSON.stringify(item.Properties ?? {});
    return (
      rendered.includes("updateAccount") &&
      rendered.includes("/cloudwatchRoleArn") &&
      rendered.includes("EvolvesproutsApiCloudWatchRole00972F46")
    );
  });
  if (!accountUpdate) {
    throw new Error(
      "Expected ApiGatewayCloudWatchAccount to call updateAccount for the RestApi CloudWatch role",
    );
  }
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
      const rt = props.ResponseTemplates as Record<string, string>;
      const encoded = JSON.stringify(rt);
      if (encoded.includes("#set") || encoded.includes("#if")) {
        throw new Error(
          `GatewayResponse ${logicalId} must use simple substitution. Found ${encoded}`,
        );
      }
      const body = rt["application/json"] ?? "";
      if (!body.includes('"message"')) {
        throw new Error(
          `GatewayResponse ${logicalId} must include a message member`,
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
  const metaAppId = (vars as Record<string, unknown>).META_APP_ID;
  if (metaAppId === undefined || metaAppId === null) {
    throw new Error(
      "InboxImportFunction must set META_APP_ID so subscription repair targets this app",
    );
  }
  const rootParams = template.findParameters("MetaAppId");
  if (!rootParams.MetaAppId) {
    throw new Error(
      "Expected CfnParameter MetaAppId for Graph subscribed_apps checks",
    );
  }
}

function assertEventbriteMediaUploadUrl(stack: cdk.Stack): void {
  const uploadUrl =
    "https://www.eventbrite.com/image-bff/api/upload";
  const template = Template.fromStack(stack);
  const parameters = template.findParameters("EventbriteMediaUploadUrl");
  const parameter = parameters.EventbriteMediaUploadUrl;
  if (!parameter || parameter.Default !== uploadUrl) {
    throw new Error(
      `Expected EventbriteMediaUploadUrl default ${uploadUrl}; found ${JSON.stringify(parameter)}`,
    );
  }
  const functions = template.findResources("AWS::Lambda::Function");
  const proxy = Object.values(functions).find((resource) => {
    const name = (resource.Properties ?? {}).FunctionName;
    return name === "evolvesprouts-AwsApiProxyFunction";
  });
  if (!proxy) {
    throw new Error(
      "Expected Lambda FunctionName evolvesprouts-AwsApiProxyFunction",
    );
  }
  const proxyVars =
    ((proxy.Properties ?? {}).Environment ?? {}).Variables ?? {};
  const allowed = JSON.stringify(
    (proxyVars as Record<string, unknown>).ALLOWED_HTTP_URLS,
  );
  if (!allowed.includes("EventbriteMediaUploadUrl")) {
    throw new Error(
      `ALLOWED_HTTP_URLS must reference EventbriteMediaUploadUrl; found ${allowed}`,
    );
  }
  const nested = stack.node.tryFindChild("EventbriteSync");
  if (!(nested instanceof cdk.NestedStack)) {
    throw new Error("Expected EventbriteSync nested stack on ApiStack");
  }
  const nestedTemplate = Template.fromStack(nested);
  const nestedFunctions = nestedTemplate.findResources("AWS::Lambda::Function");
  const processor = Object.values(nestedFunctions).find((resource) => {
    const name = (resource.Properties ?? {}).FunctionName;
    return name === "evolvesprouts-EventbriteSyncProcessor";
  });
  if (!processor) {
    throw new Error(
      "Expected Lambda FunctionName evolvesprouts-EventbriteSyncProcessor",
    );
  }
  if ((processor.Properties ?? {}).Timeout !== 120) {
    throw new Error(
      `EventbriteSyncProcessor timeout must be 120; found ${JSON.stringify((processor.Properties ?? {}).Timeout)}`,
    );
  }
  const processorVars =
    ((processor.Properties ?? {}).Environment ?? {}).Variables ?? {};
  const configured = (processorVars as Record<string, unknown>)
    .EVENTBRITE_MEDIA_UPLOAD_URL;
  const ref =
    configured && typeof configured === "object"
      ? (configured as Record<string, unknown>).Ref
      : undefined;
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error(
      `EVENTBRITE_MEDIA_UPLOAD_URL must Ref a parameter; found ${JSON.stringify(configured)}`,
    );
  }
  const queues = nestedTemplate.findResources("AWS::SQS::Queue");
  const syncQueue = Object.values(queues).find((resource) => {
    const queueName = (resource.Properties ?? {}).QueueName;
    return queueName === "evolvesprouts-eventbrite-sync-queue";
  });
  if (!syncQueue || (syncQueue.Properties ?? {}).VisibilityTimeout !== 240) {
    throw new Error(
      `eventbrite-sync-queue visibility must be 240; found ${JSON.stringify(syncQueue?.Properties ?? null)}`,
    );
  }
}

function assertEventbriteProcessorTimezone(stack: cdk.Stack): void {
  const template = Template.fromStack(stack);
  const parameters = template.findParameters("EventbriteDefaultTimezone");
  const parameter = parameters.EventbriteDefaultTimezone;
  if (!parameter || parameter.Default !== "") {
    throw new Error(
      "Expected EventbriteDefaultTimezone parameter with an empty default",
    );
  }
  const nested = stack.node.tryFindChild("EventbriteSync");
  if (!(nested instanceof cdk.NestedStack)) {
    throw new Error("Expected EventbriteSync nested stack on ApiStack");
  }
  const nestedTemplate = Template.fromStack(nested);
  const functions = nestedTemplate.findResources("AWS::Lambda::Function");
  const match = Object.entries(functions).find(([, resource]) => {
    const name = (resource.Properties ?? {}).FunctionName;
    return name === "evolvesprouts-EventbriteSyncProcessor";
  });
  if (!match) {
    throw new Error(
      "Expected Lambda FunctionName evolvesprouts-EventbriteSyncProcessor",
    );
  }
  const vars = ((match[1].Properties ?? {}).Environment ?? {}).Variables ?? {};
  const value = (vars as Record<string, unknown>).EVENTBRITE_DEFAULT_TIMEZONE;
  const ref =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).Ref
      : undefined;
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error(
      `EventbriteSyncProcessor EVENTBRITE_DEFAULT_TIMEZONE must Ref a parameter; found ${JSON.stringify(value)}`,
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

function assertMetaGraphSyncSchedule(stack: cdk.Stack): void {
  const nested = stack.node.tryFindChild("InboxImport");
  if (!(nested instanceof cdk.NestedStack)) {
    throw new Error("Expected InboxImport nested stack on ApiStack");
  }
  const template = Template.fromStack(nested);
  const functions = template.findResources("AWS::Lambda::Function");
  const match = Object.entries(functions).find(([, resource]) => {
    const name = (resource.Properties ?? {}).FunctionName;
    return name === "evolvesprouts-MetaGraphSyncSchedulerFunction";
  });
  if (!match) {
    throw new Error(
      "Expected Lambda FunctionName evolvesprouts-MetaGraphSyncSchedulerFunction",
    );
  }
  const [logicalId, resource] = match;
  const reserved = (resource.Properties ?? {}).ReservedConcurrentExecutions;
  if (reserved !== undefined) {
    throw new Error(
      `MetaGraphSyncSchedulerFunction ${logicalId} must omit ReservedConcurrentExecutions; found ${JSON.stringify(reserved)}`,
    );
  }
  const vars = ((resource.Properties ?? {}).Environment ?? {}).Variables ?? {};
  if ((vars as Record<string, unknown>).INBOX_IMPORT_QUEUE_URL == null) {
    throw new Error(
      "MetaGraphSyncSchedulerFunction must set INBOX_IMPORT_QUEUE_URL",
    );
  }
  const rules = template.findResources("AWS::Events::Rule");
  const schedule = Object.entries(rules).find(([, resource]) => {
    return (
      (resource.Properties ?? {}).Name === "evolvesprouts-meta-graph-sync-schedule"
    );
  });
  if (!schedule) {
    throw new Error(
      "Expected EventBridge rule evolvesprouts-meta-graph-sync-schedule",
    );
  }
  const expression = (schedule[1].Properties ?? {}).ScheduleExpression;
  if (expression !== "cron(0 * * * ? *)") {
    throw new Error(
      `Meta Graph sync schedule must be cron(0 * * * ? *) hourly; found ${JSON.stringify(expression)}`,
    );
  }
}

function assertSalesDailyPlanSchedule(stack: cdk.Stack): void {
  const nested = stack.node.tryFindChild("Messaging");
  if (!(nested instanceof cdk.NestedStack)) {
    throw new Error("Expected Messaging nested stack on ApiStack");
  }
  const template = Template.fromStack(nested);
  const functions = template.findResources("AWS::Lambda::Function");
  const match = Object.entries(functions).find(([, resource]) => {
    const name = (resource.Properties ?? {}).FunctionName;
    return name === "evolvesprouts-SalesDailyPlanSchedulerFunction";
  });
  if (!match) {
    throw new Error(
      "Expected Lambda FunctionName evolvesprouts-SalesDailyPlanSchedulerFunction",
    );
  }
  const [logicalId, resource] = match;
  const reserved = (resource.Properties ?? {}).ReservedConcurrentExecutions;
  if (reserved !== undefined) {
    throw new Error(
      `SalesDailyPlanSchedulerFunction ${logicalId} must omit ReservedConcurrentExecutions; found ${JSON.stringify(reserved)}`,
    );
  }
  const vars = ((resource.Properties ?? {}).Environment ?? {}).Variables ?? {};
  if ((vars as Record<string, unknown>).SALES_DAILY_PLAN_QUEUE_URL == null) {
    throw new Error(
      "SalesDailyPlanSchedulerFunction must set SALES_DAILY_PLAN_QUEUE_URL",
    );
  }
  const rules = template.findResources("AWS::Events::Rule");
  const schedule = Object.entries(rules).find(([, resource]) => {
    return (resource.Properties ?? {}).Name === "evolvesprouts-sales-daily-plan-schedule";
  });
  if (!schedule) {
    throw new Error(
      "Expected EventBridge rule evolvesprouts-sales-daily-plan-schedule",
    );
  }
  const expression = (schedule[1].Properties ?? {}).ScheduleExpression;
  if (expression !== "cron(0 22 * * ? *)") {
    throw new Error(
      `Sales daily plan schedule must be cron(0 22 * * ? *) UTC (06:00 HKT); found ${JSON.stringify(expression)}`,
    );
  }
}

function assertMailchimpWebhookInactivityAlarm(template: Template): void {
  const filters = template.findResources("AWS::Logs::MetricFilter");
  const filter = Object.entries(filters).find(([, resource]) => {
    const transform = ((resource.Properties ?? {}).MetricTransformations ?? [])[0] as
      | Record<string, unknown>
      | undefined;
    return (
      transform?.MetricNamespace === "evolvesprouts/Mailchimp" &&
      transform?.MetricName === "WebhookReceived"
    );
  });
  if (!filter) {
    throw new Error(
      "Expected AWS::Logs::MetricFilter for evolvesprouts/Mailchimp WebhookReceived",
    );
  }
  const pattern = (filter[1].Properties ?? {}).FilterPattern;
  if (pattern !== '{ $.message = "Received Mailchimp webhook" }') {
    throw new Error(
      `Mailchimp webhook metric filter must match $.message = Received Mailchimp webhook; found ${JSON.stringify(pattern)}`,
    );
  }

  const alarms = template.findResources("AWS::CloudWatch::Alarm");
  const alarm = Object.entries(alarms).find(([, resource]) => {
    return (resource.Properties ?? {}).AlarmName === "evolvesprouts-mailchimp-webhook-inactivity-alarm";
  });
  if (!alarm) {
    throw new Error(
      "Expected CloudWatch alarm evolvesprouts-mailchimp-webhook-inactivity-alarm",
    );
  }
  const props = alarm[1].Properties ?? {};
  if (props.ComparisonOperator !== "LessThanThreshold") {
    throw new Error(
      `Mailchimp webhook inactivity alarm must use LessThanThreshold; found ${JSON.stringify(props.ComparisonOperator)}`,
    );
  }
  if (props.Threshold !== 1) {
    throw new Error(
      `Mailchimp webhook inactivity alarm threshold must be 1; found ${JSON.stringify(props.Threshold)}`,
    );
  }
  if (props.EvaluationPeriods !== 7) {
    throw new Error(
      `Mailchimp webhook inactivity alarm must evaluate 7 days; found ${JSON.stringify(props.EvaluationPeriods)}`,
    );
  }
  if (props.TreatMissingData !== "breaching") {
    throw new Error(
      `Mailchimp webhook inactivity alarm must treat missing data as breaching; found ${JSON.stringify(props.TreatMissingData)}`,
    );
  }
}

function sourceArnValuesAllowLegacyAndShared(sourceArn: unknown): boolean {
  const serialized = JSON.stringify(sourceArn);
  const hasLegacy = serialized.includes(
    "receipt-rule-set/evolvesprouts-inbound-invoice-email-rule-set:receipt-rule/evolvesprouts-inbound-invoice-email-rule",
  );
  const hasShared =
    serialized.includes("SharedInboundReceiptRuleSetName") &&
    serialized.includes(
      ":receipt-rule/evolvesprouts-inbound-invoice-email-rule",
    );
  return hasLegacy && hasShared;
}

function assertInboundInvoiceSenderPatternsAreNoEcho(template: Template): void {
  const senderPatterns = template.findParameters(
    "InboundInvoiceAllowedSenderPatterns",
  ).InboundInvoiceAllowedSenderPatterns;
  if (!senderPatterns || senderPatterns.NoEcho !== true) {
    throw new Error(
      "Expected CfnParameter InboundInvoiceAllowedSenderPatterns with NoEcho",
    );
  }
}

function assertInboundInvoiceSharesReceiptRuleSet(template: Template): void {
  const serialized = JSON.stringify(template.toJSON());
  if (serialized.includes("setActiveReceiptRuleSet")) {
    throw new Error(
      "ApiStack must not call ses:SetActiveReceiptRuleSet; SES allows one active receipt rule set per region and the shared lxsoftware set owns activation",
    );
  }
  if (serialized.includes("ActivateInboundInvoiceReceiptRuleSet")) {
    throw new Error(
      "ApiStack must not define ActivateInboundInvoiceReceiptRuleSet",
    );
  }

  const parameters = template.findParameters("SharedInboundReceiptRuleSetName");
  const sharedParam = parameters.SharedInboundReceiptRuleSetName;
  if (!sharedParam || sharedParam.Default !== "lxsoftware-inbound-mail") {
    throw new Error(
      `Expected SharedInboundReceiptRuleSetName default lxsoftware-inbound-mail; found ${JSON.stringify(sharedParam)}`,
    );
  }

  const ruleSets = template.findResources("AWS::SES::ReceiptRuleSet");
  const ruleSet = Object.values(ruleSets).find((resource) => {
    return (
      (resource.Properties ?? {}).RuleSetName ===
      "evolvesprouts-inbound-invoice-email-rule-set"
    );
  });
  if (!ruleSet) {
    throw new Error(
      "Expected to keep AWS::SES::ReceiptRuleSet evolvesprouts-inbound-invoice-email-rule-set during the shared-set cutover",
    );
  }

  const rules = template.findResources("AWS::SES::ReceiptRule");
  const invoiceRule = Object.values(rules).find((resource) => {
    return (
      ((resource.Properties ?? {}).Rule ?? {}).Name ===
      "evolvesprouts-inbound-invoice-email-rule"
    );
  });
  if (!invoiceRule) {
    throw new Error(
      "Expected to keep AWS::SES::ReceiptRule evolvesprouts-inbound-invoice-email-rule",
    );
  }

  const roles = template.findResources("AWS::IAM::Role");
  const receiptRole = Object.values(roles).find((resource) => {
    return ((resource.Properties ?? {}).Description as string | undefined)?.includes(
      "raw invoice emails",
    );
  });
  if (!receiptRole) {
    throw new Error("Expected InboundInvoiceReceiptRole");
  }
  const assumeStatements =
    ((receiptRole.Properties ?? {}).AssumeRolePolicyDocument as { Statement?: unknown[] })
      ?.Statement ?? [];
  const sesAssume = assumeStatements.find((statement) => {
    const item = statement as { Principal?: { Service?: unknown } };
    return item.Principal?.Service === "ses.amazonaws.com";
  }) as { Condition?: { ArnLike?: { "AWS:SourceArn"?: unknown } } } | undefined;
  if (!sourceArnValuesAllowLegacyAndShared(sesAssume?.Condition?.ArnLike?.["AWS:SourceArn"])) {
    throw new Error(
      `InboundInvoiceReceiptRole must trust both receipt-rule SourceArns; found ${JSON.stringify(sesAssume)}`,
    );
  }

  const buckets = template.findResources("AWS::S3::BucketPolicy");
  const assetsPolicy = Object.values(buckets).find((resource) => {
    return JSON.stringify(resource).includes("AllowSesInboundInvoiceWrites");
  });
  if (!assetsPolicy) {
    throw new Error("Expected AssetsBucket policy AllowSesInboundInvoiceWrites");
  }
  const bucketStatements =
    ((assetsPolicy.Properties ?? {}).PolicyDocument as { Statement?: unknown[] })
      ?.Statement ?? [];
  const sesWrite = bucketStatements.find((statement) => {
    return (statement as { Sid?: string }).Sid === "AllowSesInboundInvoiceWrites";
  }) as { Condition?: { StringEquals?: { "AWS:SourceArn"?: unknown } } } | undefined;
  if (
    !sourceArnValuesAllowLegacyAndShared(
      sesWrite?.Condition?.StringEquals?.["AWS:SourceArn"],
    )
  ) {
    throw new Error(
      `AssetsBucket SES write policy must allow both receipt-rule SourceArns; found ${JSON.stringify(sesWrite)}`,
    );
  }

  const keys = template.findResources("AWS::KMS::Key");
  const sqsKey = Object.values(keys).find((resource) => {
    return JSON.stringify(resource).includes("AllowSesInboundInvoiceTopicEncryption");
  });
  if (!sqsKey) {
    throw new Error("Expected SQS KMS key policy AllowSesInboundInvoiceTopicEncryption");
  }
  const keyStatements =
    ((sqsKey.Properties ?? {}).KeyPolicy as { Statement?: unknown[] })?.Statement ?? [];
  const sesKms = keyStatements.find((statement) => {
    return (statement as { Sid?: string }).Sid === "AllowSesInboundInvoiceTopicEncryption";
  }) as { Condition?: { StringEquals?: { "AWS:SourceArn"?: unknown } } } | undefined;
  if (
    !sourceArnValuesAllowLegacyAndShared(
      sesKms?.Condition?.StringEquals?.["AWS:SourceArn"],
    )
  ) {
    throw new Error(
      `SQS KMS key must allow both receipt-rule SourceArns; found ${JSON.stringify(sesKms)}`,
    );
  }
}

function assertApiTokenAuthorizerCachesAuthorizationHeader(template: Template): void {
  const authorizers = template.findResources("AWS::ApiGateway::Authorizer");
  const token = Object.values(authorizers).filter((resource) => {
    return JSON.stringify(resource.Properties?.AuthorizerUri ?? "").includes(
      "ApiTokenAuthorizer",
    );
  });
  if (token.length !== 1) {
    throw new Error(
      `Expected one API token authorizer, found ${token.length}`,
    );
  }
  const properties = token[0].Properties ?? {};
  if (properties.AuthorizerResultTtlInSeconds !== 300) {
    throw new Error(
      `API token authorizer cache must be 300 seconds, found ${JSON.stringify(properties.AuthorizerResultTtlInSeconds)}`,
    );
  }
  const identity = JSON.stringify(properties.IdentitySource ?? "");
  if (!identity.includes("method.request.header.Authorization")) {
    throw new Error(
      `API token authorizer cache key must be Authorization, found ${identity}`,
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

function assertFinanceReadonlyDataApi(template: Template): void {
  const clusters = template.findResources("AWS::RDS::DBCluster");
  const clusterEntries = Object.entries(clusters);
  if (clusterEntries.length !== 1) {
    throw new Error(
      `Expected one DB cluster; found ${clusterEntries.length}`,
    );
  }
  const [, cluster] = clusterEntries[0];
  if (cluster.Properties?.EnableHttpEndpoint !== true) {
    throw new Error(
      `DB cluster must set EnableHttpEndpoint; found ${JSON.stringify(cluster.Properties?.EnableHttpEndpoint)}`,
    );
  }

  const secrets = template.findResources("AWS::SecretsManager::Secret");
  const financeSecret = Object.entries(secrets).find(([, resource]) => {
    return (
      resource.Properties?.Name ===
      "evolvesprouts-db-finance-readonly-credentials"
    );
  });
  if (!financeSecret) {
    throw new Error(
      "Expected secret evolvesprouts-db-finance-readonly-credentials",
    );
  }
  const [financeLogicalId, financeResource] = financeSecret;
  const templateJson = JSON.stringify(
    financeResource.Properties?.GenerateSecretString?.SecretStringTemplate,
  );
  if (!templateJson.includes("evolvesprouts_finance_ro")) {
    throw new Error(
      `Finance secret must use username evolvesprouts_finance_ro; found ${templateJson}`,
    );
  }

  const proxies = template.findResources("AWS::RDS::DBProxy");
  for (const [logicalId, resource] of Object.entries(proxies)) {
    const auth = JSON.stringify(resource.Properties?.Auth ?? []);
    if (auth.includes(financeLogicalId)) {
      throw new Error(
        `RDS Proxy ${logicalId} must not authenticate with the finance read-only secret`,
      );
    }
  }

  const outputs = template.findOutputs("FinanceReadonlyDatabaseSecretArn");
  if (!outputs.FinanceReadonlyDatabaseSecretArn) {
    throw new Error("Expected output FinanceReadonlyDatabaseSecretArn");
  }

  const functions = template.findResources("AWS::Lambda::Function");
  const migration = Object.entries(functions).find(([, resource]) => {
    const handler = resource.Properties?.Handler;
    return handler === "lambda/migrations/handler.lambda_handler";
  });
  if (!migration) {
    throw new Error("Expected migrations Lambda");
  }
  const variables = migration[1].Properties?.Environment?.Variables ?? {};
  if (!("DATABASE_FINANCE_READONLY_SECRET_ARN" in variables)) {
    throw new Error(
      "Migrations Lambda must set DATABASE_FINANCE_READONLY_SECRET_ARN",
    );
  }
}

const LOG_STREAM_SCOPED_ACTIONS = new Set([
  "logs:PutLogEvents",
  "logs:GetLogEvents",
  "logs:CreateLogStream",
  "logs:DeleteLogStream",
]);

function flattenArn(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "Fn::Join" in value) {
    const [, parts] = (value as { "Fn::Join": [string, unknown[]] })["Fn::Join"];
    return parts.map((part) => (typeof part === "string" ? part : "<token>")).join("");
  }
  return JSON.stringify(value);
}

// From April 26, 2027 CloudWatch Logs only authorizes log-group actions
// against a log-group ARN; a log-stream ARN (`...:*`) no longer grants them.
function assertLogGroupActionsUseLogGroupArn(template: Template): void {
  const policies = template.findResources("AWS::IAM::Policy");
  for (const [logicalId, resource] of Object.entries(policies)) {
    const statements: Record<string, unknown>[] =
      resource.Properties?.PolicyDocument?.Statement ?? [];
    for (const statement of statements) {
      if (statement.Effect !== "Allow") {
        continue;
      }
      const actions = ([] as unknown[]).concat(statement.Action ?? []);
      const groupActions = actions.filter(
        (action): action is string =>
          typeof action === "string" &&
          action.startsWith("logs:") &&
          !LOG_STREAM_SCOPED_ACTIONS.has(action),
      );
      if (groupActions.length === 0) {
        continue;
      }
      const arns = ([] as unknown[])
        .concat(statement.Resource ?? [])
        .map(flattenArn)
        .filter((arn) => arn.includes(":logs:"));
      const isStreamArn = (arn: string): boolean =>
        arn.endsWith(":*") || arn.includes(":log-stream:");
      if (arns.some(isStreamArn) && !arns.some((arn) => !isStreamArn(arn))) {
        throw new Error(
          `${logicalId} grants ${groupActions.join(", ")} only on log-stream ARNs ` +
            `(${arns.join(", ")}); add the log-group ARN`,
        );
      }
    }
  }
}

function assertRetainedSecurityGroupsAndProxyTags(template: Template): void {
  const groups = template.findResources("AWS::EC2::SecurityGroup");
  for (const groupName of ["evolvesprouts-lambda-sg", "evolvesprouts-migration-sg"]) {
    const match = Object.entries(groups).find(
      ([, resource]) => resource.Properties?.GroupName === groupName,
    );
    if (!match) {
      throw new Error(`Expected security group ${groupName}`);
    }
    const [logicalId, resource] = match;
    const policy = resource as {
      DeletionPolicy?: string;
      UpdateReplacePolicy?: string;
    };
    if (policy.DeletionPolicy !== "Retain" || policy.UpdateReplacePolicy !== "Retain") {
      throw new Error(
        `${logicalId} (${groupName}) must retain on delete and on replace; ` +
          `DeletionPolicy=${policy.DeletionPolicy} ` +
          `UpdateReplacePolicy=${policy.UpdateReplacePolicy}`,
      );
    }
  }

  const targetGroups = template.findResources("AWS::RDS::DBProxyTargetGroup");
  const targetGroupEntries = Object.entries(targetGroups);
  if (targetGroupEntries.length === 0) {
    throw new Error("Expected an AWS::RDS::DBProxyTargetGroup");
  }
  for (const [logicalId, resource] of targetGroupEntries) {
    if (resource.Properties && "Tags" in resource.Properties) {
      throw new Error(
        `${logicalId} must not set Tags; that resource type has no Tags property`,
      );
    }
  }

  const proxies = template.findResources("AWS::RDS::DBProxy");
  const proxyIsTagged = Object.values(proxies).some((resource) => {
    const tags = (resource.Properties?.Tags ?? []) as { Key?: string }[];
    const keys = new Set(tags.map((tag) => tag.Key));
    return keys.has("Organization") && keys.has("Project");
  });
  if (!proxyIsTagged) {
    throw new Error(
      "RDS proxy must still receive the stack Organization and Project tags",
    );
  }

  const clients = template.findResources("AWS::Cognito::UserPoolClient");
  const client = Object.entries(clients).find(([logicalId]) =>
    logicalId.includes("EvolvesproutsUserPoolClient"),
  );
  if (!client) {
    throw new Error("Expected EvolvesproutsUserPoolClient");
  }
  const dependsOn = (client[1] as { DependsOn?: string | string[] }).DependsOn;
  const dependencies = Array.isArray(dependsOn)
    ? dependsOn
    : dependsOn
      ? [dependsOn]
      : [];
  if (!dependencies.some((dependency) => dependency.includes("GoogleIdentityProvider"))) {
    throw new Error(
      `User pool client must depend on the Google identity provider; ` +
        `DependsOn=${JSON.stringify(dependsOn)}`,
    );
  }
}

function assertApiCustomDomainMapsAtRoot(template: Template): void {
  const mappings = template.findResources("AWS::ApiGateway::BasePathMapping");
  const entries = Object.entries(mappings);
  if (entries.length !== 1) {
    throw new Error(`Expected only the root mapping; found ${entries.length}`);
  }
  const [rootLogicalId, rootMapping] = entries[0];
  const rootBasePath = rootMapping.Properties?.BasePath;
  if (rootBasePath !== "" && rootBasePath !== undefined) {
    throw new Error(
      `${rootLogicalId} must map at the root. Found ${JSON.stringify(rootBasePath)}`,
    );
  }
  if (rootMapping.Condition !== "UseApiCustomDomain") {
    throw new Error(
      `${rootLogicalId} must be created only when UseApiCustomDomain is true`,
    );
  }
  const stages = template.findResources("AWS::ApiGateway::Stage");
  const stageEntries = Object.entries(stages);
  if (stageEntries.length !== 1) {
    throw new Error(`Expected one API stage; found ${stageEntries.length}`);
  }
  const [stageLogicalId, stage] = stageEntries[0];
  const stageName = stage.Properties?.StageName;
  if (typeof stageName !== "string" || stageName.length === 0) {
    throw new Error(`API stage ${stageLogicalId} is missing StageName`);
  }
  const apis = template.findResources("AWS::ApiGateway::RestApi");
  const apiEntries = Object.entries(apis);
  if (apiEntries.length !== 1) {
    throw new Error(`Expected one REST API; found ${apiEntries.length}`);
  }
  const [apiLogicalId, api] = apiEntries[0];
  if (api.Properties?.DisableExecuteApiEndpoint !== true) {
    throw new Error(
      `REST API must disable the execute-api hostname. Found ${JSON.stringify(api.Properties?.DisableExecuteApiEndpoint)}`,
    );
  }
  if (stage.Properties?.Variables?.executeApiEndpoint !== "disabled") {
    throw new Error(
      `API stage variable executeApiEndpoint must be "disabled". Found ${JSON.stringify(stage.Properties?.Variables?.executeApiEndpoint)}`,
    );
  }
  const parameters = template.toJSON().Parameters as Record<
    string,
    { MinLength?: number }
  >;
  if ("ApiDisableExecuteApiEndpoint" in parameters) {
    throw new Error("ApiDisableExecuteApiEndpoint must not be a stack parameter");
  }
  for (const name of ["ApiCustomDomainName", "ApiCustomDomainCertificateArn"]) {
    if (parameters[name]?.MinLength !== 1) {
      throw new Error(
        `${name} must reject an empty value. Found ${JSON.stringify(parameters[name])}`,
      );
    }
  }
  const dependsOn = (stage as { DependsOn?: string | string[] }).DependsOn;
  const dependencies = Array.isArray(dependsOn)
    ? dependsOn
    : dependsOn
      ? [dependsOn]
      : [];
  if (!dependencies.includes(apiLogicalId)) {
    throw new Error(
      `Stage ${stageLogicalId} must depend on ${apiLogicalId} so the stage update follows DisableExecuteApiEndpoint. DependsOn=${JSON.stringify(dependsOn)}`,
    );
  }

  const distributions = template.findResources("AWS::CloudFront::Distribution");
  const assetShareDistribution = Object.entries(distributions).find(([, distribution]) =>
    (distribution.Properties?.DistributionConfig?.CacheBehaviors ?? []).some(
      (behavior: { PathPattern?: unknown }) => behavior.PathPattern === "v1/assets/share/*",
    ),
  );
  if (!assetShareDistribution) {
    throw new Error("Asset-share CloudFront distribution must serve v1/assets/share/*");
  }
  const [distributionLogicalId, distribution] = assetShareDistribution;
  if (!dependencies.includes(distributionLogicalId)) {
    throw new Error(
      `Stage ${stageLogicalId} must depend on ${distributionLogicalId} so execute-api stays up until share links move. DependsOn=${JSON.stringify(dependsOn)}`,
    );
  }
  const config = distribution.Properties?.DistributionConfig ?? {};
  const behaviors = (config.CacheBehaviors ?? []) as Array<{
    PathPattern?: unknown;
    TargetOriginId?: unknown;
    FunctionAssociations?: Array<{ EventType?: unknown; FunctionARN?: unknown }>;
  }>;
  const shareBehavior = behaviors.find((behavior) => behavior.PathPattern === "v1/assets/share/*");
  const emailBehavior = behaviors.find(
    (behavior) => behavior.PathPattern === "v1/assets/email-download/*",
  );
  const prodShareBehavior = behaviors.find(
    (behavior) => behavior.PathPattern === "prod/v1/assets/share/*",
  );
  const prodEmailBehavior = behaviors.find(
    (behavior) => behavior.PathPattern === "prod/v1/assets/email-download/*",
  );
  if (!shareBehavior || !emailBehavior || !prodShareBehavior || !prodEmailBehavior) {
    throw new Error(
      "Asset-share distribution must keep share and email-download viewer paths, including /prod",
    );
  }
  const origins = (config.Origins ?? []) as Array<{
    Id?: unknown;
    DomainName?: unknown;
    OriginPath?: unknown;
  }>;
  const assetShareOrigin = origins.find((origin) => origin.Id === shareBehavior.TargetOriginId);
  if (!assetShareOrigin) {
    throw new Error("Asset-share behavior must target an origin on the same distribution");
  }
  const originPath = assetShareOrigin.OriginPath;
  if (originPath === `/${stageName}` || (typeof originPath === "string" && originPath.includes(stageName))) {
    throw new Error(
      `Asset-share origin must not use /${stageName}. Found ${JSON.stringify(originPath)}`,
    );
  }
  const domainName = JSON.stringify(assetShareOrigin.DomainName ?? "");
  if (!domainName.includes("ApiCustomDomainName")) {
    throw new Error(
      `Asset-share origin must use ApiCustomDomainName. Found ${domainName}`,
    );
  }
  if (domainName.includes("execute-api")) {
    throw new Error(
      `Asset-share origin must not use the execute-api hostname. Found ${domainName}`,
    );
  }
  const functions = template.findResources("AWS::CloudFront::Function") as Record<
    string,
    { Properties?: { FunctionCode?: unknown } }
  >;
  const rewrite = Object.values(functions).find((resource) => {
    const code = String(resource.Properties?.FunctionCode ?? "");
    return (
      code.includes("/v1/public/assets/share/") &&
      code.includes("/v1/public/assets/email-download/") &&
      code.includes("'/prod/'")
    );
  });
  if (!rewrite) {
    throw new Error(
      "Asset-share distribution must rewrite viewer paths to /v1/public/assets/share and /v1/public/assets/email-download",
    );
  }
  for (const behavior of [
    shareBehavior,
    emailBehavior,
    prodShareBehavior,
    prodEmailBehavior,
  ]) {
    const viewerRequest = (behavior.FunctionAssociations ?? []).filter(
      (association) => association.EventType === "viewer-request",
    );
    if (viewerRequest.length !== 1) {
      throw new Error(
        `${String(behavior.PathPattern)} must have one viewer-request function`,
      );
    }
  }
  if (
    JSON.stringify(prodShareBehavior.FunctionAssociations) !==
    JSON.stringify(shareBehavior.FunctionAssociations)
  ) {
    throw new Error("prod/v1/assets/share/* must use the share-path rewrite");
  }
}

function assertTokenAuthorizerCoverage(template: Template): void {
  const authorizers = template.findResources("AWS::ApiGateway::Authorizer");
  const tokenIds = Object.entries(authorizers)
    .filter(([, resource]) =>
      JSON.stringify(resource.Properties?.AuthorizerUri ?? "").includes(
        "ApiTokenAuthorizer",
      ),
    )
    .map(([logicalId]) => logicalId);
  if (tokenIds.length !== 1) {
    throw new Error(`Expected one API token authorizer, found ${tokenIds.length}`);
  }
  const tokenId = tokenIds[0];
  const resources = template.findResources("AWS::ApiGateway::Resource") as Record<
    string,
    { Properties?: { PathPart?: unknown; ParentId?: unknown } }
  >;

  function resourcePath(logicalId: string, seen: Set<string>): string {
    if (seen.has(logicalId)) {
      throw new Error(`API Gateway resource cycle at ${logicalId}`);
    }
    const properties = resources[logicalId]?.Properties;
    const part = properties?.PathPart;
    if (typeof part !== "string") {
      return "";
    }
    const nextSeen = new Set(seen);
    nextSeen.add(logicalId);
    const parent = properties?.ParentId;
    const parentRef =
      parent && typeof parent === "object" && parent !== null && "Ref" in parent
        ? String((parent as { Ref: unknown }).Ref)
        : "";
    const parentPath = parentRef ? resourcePath(parentRef, nextSeen) : "";
    return `${parentPath}/${part}`;
  }

  const paths = new Map<string, string>();
  for (const logicalId of Object.keys(resources)) {
    paths.set(logicalId, resourcePath(logicalId, new Set()));
  }
  const methods = template.findResources("AWS::ApiGateway::Method") as Record<
    string,
    {
      Properties?: {
        HttpMethod?: unknown;
        ResourceId?: unknown;
        AuthorizerId?: unknown;
      };
    }
  >;
  // Retired /v1/public/{proxy+} still carries the token authorizer on this
  // branch. Later branches drop the alias or the authorizer and this set.
  const publicExempt = new Set(["/v1/public/{proxy+}"]);
  const seenExempt = new Set<string>();
  let partnerMethods = 0;
  for (const method of Object.values(methods)) {
    const properties = method.Properties ?? {};
    const resourceId = properties.ResourceId;
    const ref =
      resourceId && typeof resourceId === "object" && resourceId !== null && "Ref" in resourceId
        ? String((resourceId as { Ref: unknown }).Ref)
        : "";
    const routePath = paths.get(ref) ?? "";
    if (properties.HttpMethod === "OPTIONS") {
      continue;
    }
    const usesToken = JSON.stringify(properties.AuthorizerId ?? "").includes(tokenId);
    if (routePath === "/v1/partner" || routePath.startsWith("/v1/partner/")) {
      partnerMethods += 1;
      if (!usesToken) {
        throw new Error(
          `${String(properties.HttpMethod)} ${routePath} must use the API token authorizer`,
        );
      }
    }
    if (routePath === "/v1/public" || routePath.startsWith("/v1/public/")) {
      if (publicExempt.has(routePath)) {
        seenExempt.add(routePath);
        if (!usesToken) {
          throw new Error(
            `${String(properties.HttpMethod)} ${routePath} is the exempt public alias and must keep the token authorizer`,
          );
        }
        continue;
      }
      if (usesToken) {
        throw new Error(
          `${String(properties.HttpMethod)} ${routePath} must not use the API token authorizer`,
        );
      }
    }
  }
  if (partnerMethods === 0) {
    throw new Error("Expected at least one /v1/partner/ method");
  }
  for (const routePath of publicExempt) {
    if (!seenExempt.has(routePath)) {
      throw new Error(`Missing exempt public alias ${routePath}`);
    }
  }
}

function assertPublicContactMergeRoute(template: Template): void {
  const resources = template.findResources("AWS::ApiGateway::Resource") as Record<
    string,
    { Properties?: { PathPart?: unknown; ParentId?: unknown } }
  >;

  function resourcePath(logicalId: string, seen: Set<string>): string {
    if (seen.has(logicalId)) {
      throw new Error(`API Gateway resource cycle at ${logicalId}`);
    }
    const properties = resources[logicalId]?.Properties;
    const part = properties?.PathPart;
    if (typeof part !== "string") {
      return "";
    }
    const nextSeen = new Set(seen);
    nextSeen.add(logicalId);
    const parent = properties?.ParentId;
    const parentRef =
      parent && typeof parent === "object" && parent !== null && "Ref" in parent
        ? String((parent as { Ref: unknown }).Ref)
        : "";
    const parentPath = parentRef ? resourcePath(parentRef, nextSeen) : "";
    return `${parentPath}/${part}`;
  }

  const mergeIds = Object.keys(resources).filter(
    (logicalId) => resourcePath(logicalId, new Set()) === "/v1/partner/{proxy+}",
  );
  if (mergeIds.length !== 1) {
    throw new Error(
      `Expected one /v1/partner/{proxy+} resource, found ${mergeIds.join(", ") || "none"}`,
    );
  }
  const methods = template.findResources("AWS::ApiGateway::Method") as Record<
    string,
    { Properties?: { HttpMethod?: unknown; ResourceId?: unknown; AuthorizationType?: unknown } }
  >;
  const posts = Object.values(methods).filter((method) => {
    const properties = method.Properties;
    const resourceId = properties?.ResourceId;
    const ref =
      resourceId && typeof resourceId === "object" && resourceId !== null && "Ref" in resourceId
        ? String((resourceId as { Ref: unknown }).Ref)
        : "";
    return properties?.HttpMethod === "ANY" && ref === mergeIds[0];
  });
  if (posts.length !== 1) {
    throw new Error(
      `Expected one ANY method on /v1/partner/{proxy+}, found ${posts.length}`,
    );
  }
  if (posts[0].Properties?.AuthorizationType !== "CUSTOM") {
    throw new Error(
      "ANY /v1/partner/{proxy+} must use the API token authorizer",
    );
  }
}

function main(): void {
  assertProductionApiCustomDomain();
  const app = new cdk.App();
  const stack = new ApiStack(app, "TestApi", {
    env: { account: "111111111111", region: "ap-southeast-1" },
  });
  const template = Template.fromStack(stack);
  const resourceCount = Object.keys(template.toJSON().Resources ?? {}).length;
  console.log(`API stack resource count: ${resourceCount}`);
  if (resourceCount > 495) {
    throw new Error(`API stack has ${resourceCount} resources, over the 495 limit`);
  }
  assertApiGatewayCloudWatchLogging(template);
  assertStageHasNoApiGatewayCacheCluster(template);
  assertGatewayResponsesHaveNoBodyTemplates(template);
  assertStageHasCheckovCkv120Suppression(template);
  assertPollResponsesTableUsesCustomerManagedKms(template);
  assertPollResponsesTableHasExpiresAtTtl(template);
  assertCognitoClientAllowlistWiring(template);
  assertApiTokenAuthorizerHasNoReservedConcurrency(template);
  assertApiTokenAuthorizerCachesAuthorizationHeader(template);
  assertPublicContactMergeRoute(template);
  assertTokenAuthorizerCoverage(template);
  assertMailchimpWebhookInactivityAlarm(template);
  assertInboxImportHasNoReservedConcurrency(stack);
  assertInboxImportUsesDedicatedPageToken(stack);
  assertMetaGraphSyncSchedule(stack);
  assertEventbriteProcessorTimezone(stack);
  assertEventbriteMediaUploadUrl(stack);
  assertSalesDailyPlanSchedule(stack);
  assertInboundInvoiceSenderPatternsAreNoEcho(template);
  assertInboundInvoiceSharesReceiptRuleSet(template);
  assertFinanceReadonlyDataApi(template);
  assertLogGroupActionsUseLogGroupArn(template);
  assertRetainedSecurityGroupsAndProxyTags(template);
  assertApiCustomDomainMapsAtRoot(template);
  assertApiStackInvariants(stack, template);

  console.log("api-stack API Gateway stage cache assertions passed.");
}

try {
  main();
} catch (err) {

  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
