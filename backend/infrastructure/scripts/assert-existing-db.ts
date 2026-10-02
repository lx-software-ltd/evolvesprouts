import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { DatabaseConstruct } from "../lib/constructs";

function assertExistingResources(): void {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, "ExistingResourcesStack", {
    env: { account: "111111111111", region: "us-east-1" },
  });
  const vpc = new ec2.Vpc(stack, "Vpc", {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      { name: "Private", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
  const secretName = "example-000000";
  const secretArn = stack.formatArn({
    service: "secretsmanager",
    resource: "secret",
    resourceName: secretName,
    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
  });
  const appSecretName = "example-app-000000";
  const appSecretArn = stack.formatArn({
    service: "secretsmanager",
    resource: "secret",
    resourceName: appSecretName,
    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
  });
  const adminSecretName = "example-admin-000000";
  const adminSecretArn = stack.formatArn({
    service: "secretsmanager",
    resource: "secret",
    resourceName: adminSecretName,
    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
  });
  const clusterEndpoint = "cluster.example.us-east-1.rds.amazonaws.com";
  const clusterReaderEndpoint =
    "cluster-ro.example.us-east-1.rds.amazonaws.com";
  const proxyArn = stack.formatArn({
    service: "rds",
    resource: "db-proxy",
    resourceName: "prx-123",
    arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
  });
  const proxyEndpoint = "proxy.example.us-east-1.rds.amazonaws.com";

  new DatabaseConstruct(stack, "Database", {
    resourcePrefix: "test",
    vpc,
    dbCredentialsSecretArn: secretArn,
    dbAppUserSecretArn: appSecretArn,
    dbAdminUserSecretArn: adminSecretArn,
    dbSecurityGroupId: "sg-0123456789abcdef0",
    proxySecurityGroupId: "sg-abcdef0123456789",
    dbClusterIdentifier: "existing-cluster",
    dbClusterEndpoint: clusterEndpoint,
    dbClusterReaderEndpoint: clusterReaderEndpoint,
    dbClusterPort: 5432,
    dbProxyName: "existing-proxy",
    dbProxyArn: proxyArn,
    dbProxyEndpoint: proxyEndpoint,
    manageSecurityGroupRules: false,
  });

  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::RDS::DBCluster", 0);
  template.resourceCountIs("AWS::RDS::DBProxy", 0);
  // Imported credentials are not recreated. The finance read-only secret is
  // still created so the Data API role exists in every environment.
  template.resourceCountIs("AWS::SecretsManager::Secret", 1);
  template.hasResourceProperties("AWS::SecretsManager::Secret", {
    Name: "test-db-finance-readonly-credentials",
  });
}

function assertNewResources(): void {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, "NewResourcesStack", {
    env: { account: "111111111111", region: "us-east-1" },
  });
  const vpc = new ec2.Vpc(stack, "Vpc", {
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      { name: "Private", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });

  new DatabaseConstruct(stack, "Database", {
    resourcePrefix: "test",
    vpc,
    minCapacity: 0.5,
    maxCapacity: 1,
    databaseName: "testdb",
  });

  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::RDS::DBCluster", 1);
  template.resourceCountIs("AWS::RDS::DBProxy", 1);
  // Master, app, admin, and finance read-only credentials.
  template.resourceCountIs("AWS::SecretsManager::Secret", 4);
  template.hasResourceProperties("AWS::RDS::DBCluster", {
    EnableHttpEndpoint: true,
  });
}

function main(): void {
  assertExistingResources();
  assertNewResources();

  console.log("OK");
}

main();
