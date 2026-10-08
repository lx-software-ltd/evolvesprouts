import { readFileSync } from "node:fs";
import path from "node:path";

import * as cdk from "aws-cdk-lib";
import { NestedStack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { ApiStack } from "../lib/api-stack";

/**
 * The prefix is the assignment in api-stack.ts. params/production.json is a
 * CloudFormation parameter bag: deploy forwards every key, so this value
 * cannot live there.
 */
export function resourcePrefixFromApiStackSource(): string {
  const sourcePath = path.join(__dirname, "../lib/api-stack.ts");
  const source = readFileSync(sourcePath, "utf8");
  const match = source.match(/const resourcePrefix = "([a-z0-9-]+)";/);
  if (!match?.[1]) {
    throw new Error(
      'api-stack.ts must assign const resourcePrefix = "<kebab-case>".',
    );
  }
  return match[1];
}

function secretNamePattern(resourcePrefix: string): RegExp {
  const escaped = resourcePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-[a-z0-9]+(?:-[a-z0-9]+)*$`);
}

export function assertExplicitSecretNames(
  template: Template,
  resourcePrefix: string,
  requireAtLeastOne: boolean,
): void {
  const pattern = secretNamePattern(resourcePrefix);
  const secrets = template.findResources("AWS::SecretsManager::Secret");
  const entries = Object.entries(secrets);
  if (requireAtLeastOne && entries.length === 0) {
    throw new Error("Expected at least one Secrets Manager secret on ApiStack");
  }
  for (const [logicalId, resource] of entries) {
    const name = (resource.Properties ?? {}).Name;
    if (typeof name !== "string" || !pattern.test(name)) {
      throw new Error(
        `Secret ${logicalId} must set secretName to ${resourcePrefix}-<kebab-case>. Found ${JSON.stringify(name)}`,
      );
    }
  }
}

export function assertNoWildcardCors(template: Template, label: string): void {
  const serialized = JSON.stringify(template.toJSON());
  if (/"AllowOrigins"\s*:\s*\[[^\]]*"\*"\s*\]/.test(serialized)) {
    throw new Error(`${label} AllowOrigins must not include *`);
  }
  if (/"Access-Control-Allow-Origin"\s*:\s*"'\*'"/.test(serialized)) {
    throw new Error(`${label} Access-Control-Allow-Origin must not be *`);
  }
  if (/"Access-Control-Allow-Origin"\s*:\s*"\*"/.test(serialized)) {
    throw new Error(`${label} Access-Control-Allow-Origin must not be *`);
  }
}

export function assertApiStackInvariants(
  stack: cdk.Stack,
  parentTemplate: Template,
): void {
  const resourcePrefix = resourcePrefixFromApiStackSource();
  const nested = stack.node
    .findAll()
    .filter((child): child is NestedStack => NestedStack.isNestedStack(child));
  const templates = [
    {
      label: stack.node.id,
      template: parentTemplate,
      requireSecrets: true,
    },
    ...nested.map((child) => ({
      label: child.node.path,
      template: Template.fromStack(child),
      requireSecrets: false,
    })),
  ];
  for (const entry of templates) {
    assertExplicitSecretNames(
      entry.template,
      resourcePrefix,
      entry.requireSecrets,
    );
    assertNoWildcardCors(entry.template, entry.label);
  }
}

function main(): void {
  const app = new cdk.App();
  const stack = new ApiStack(app, "TestApi", {
    env: { account: "111111111111", region: "ap-southeast-1" },
  });
  assertApiStackInvariants(stack, Template.fromStack(stack));
  console.log("stack invariant assertions passed.");
}

// test:infra runs these checks from api-stack.test.ts so the stack is synthesized once.
if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
