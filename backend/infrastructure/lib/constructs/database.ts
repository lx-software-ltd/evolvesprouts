import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { STANDARD_LOG_RETENTION, selectPrivateSubnets } from "./python-lambda";

/**
 * Properties for the DatabaseConstruct.
 */
export interface DatabaseConstructProps {
  /** Resource name prefix for naming resources. */
  resourcePrefix: string;
  /** VPC to deploy the database into. */
  vpc: ec2.IVpc;
  /** Minimum serverless capacity in ACUs. */
  minCapacity?: number;
  /** Maximum serverless capacity in ACUs. */
  maxCapacity?: number;
  /** Default database name. */
  databaseName?: string;
  /** Existing database credentials secret name (optional). */
  dbCredentialsSecretName?: string;
  /** Existing database credentials secret ARN (optional). */
  dbCredentialsSecretArn?: string;
  /** Existing database secret KMS key ARN (optional). */
  dbCredentialsSecretKmsKeyArn?: string;
  /** Existing app user secret name (optional). */
  dbAppUserSecretName?: string;
  /** Existing app user secret ARN (optional). */
  dbAppUserSecretArn?: string;
  /** Existing app user secret KMS key ARN (optional). */
  dbAppUserSecretKmsKeyArn?: string;
  /** Existing admin user secret name (optional). */
  dbAdminUserSecretName?: string;
  /** Existing admin user secret ARN (optional). */
  dbAdminUserSecretArn?: string;
  /** Existing admin user secret KMS key ARN (optional). */
  dbAdminUserSecretKmsKeyArn?: string;
  /** Existing database security group id (optional). */
  dbSecurityGroupId?: string;
  /** Existing proxy security group id (optional). */
  proxySecurityGroupId?: string;
  /** Existing database cluster identifier (optional). */
  dbClusterIdentifier?: string;
  /** Existing database cluster endpoint hostname (optional). */
  dbClusterEndpoint?: string;
  /** Existing database cluster reader endpoint hostname (optional). */
  dbClusterReaderEndpoint?: string;
  /** Existing database cluster port (optional). */
  dbClusterPort?: number;
  /** Existing database proxy name (optional). */
  dbProxyName?: string;
  /** Existing database proxy ARN (optional). */
  dbProxyArn?: string;
  /** Existing database proxy endpoint (optional). */
  dbProxyEndpoint?: string;
  /** Manage ingress rules on security groups (optional). */
  manageSecurityGroupRules?: boolean;
  /** Apply immutable DB settings like encryption and IAM auth. */
  applyImmutableSettings?: boolean;
  /** Automated backup retention in days (default 14). */
  backupRetentionDays?: number;
  /** Enable cluster deletion protection (default true). */
  deletionProtection?: boolean;
}

/**
 * Construct for Aurora PostgreSQL Serverless v2 database with RDS Proxy.
 *
 * Creates:
 * - Security groups for database and proxy
 * - Secrets Manager secret for database credentials
 * - Password secret for the finance read-only role (Data API)
 * - Aurora PostgreSQL Serverless v2 cluster with the Data API enabled
 * - RDS Proxy with IAM authentication
 */
export class DatabaseConstruct extends Construct {
  /** The Aurora database cluster. */
  public readonly cluster: rds.IDatabaseCluster;
  /** The RDS Proxy for connection pooling. */
  public readonly proxy: rds.IDatabaseProxy;
  /** The database credentials secret. */
  public readonly secret: secretsmanager.ISecret;
  /** App database user secret (evolvesprouts_app). */
  public readonly appUserSecret: secretsmanager.ISecret;
  /** Admin database user secret (evolvesprouts_admin). */
  public readonly adminUserSecret: secretsmanager.ISecret;
  /** Finance mirror secret (evolvesprouts_finance_ro, password login). */
  public readonly financeReadonlySecret: secretsmanager.ISecret;
  /** Security group for the database cluster. */
  public readonly dbSecurityGroup: ec2.ISecurityGroup;
  /** Security group for the RDS Proxy. */
  public readonly proxySecurityGroup: ec2.ISecurityGroup;
  /** Whether to manage security group ingress rules. */
  private readonly manageSecurityGroupRules: boolean;
  /** KMS key used to encrypt the database secret. */
  private readonly secretKmsKey?: kms.IKey;
  /** KMS key used to encrypt the app user secret. */
  private readonly appUserSecretKmsKey?: kms.IKey;
  /** KMS key used to encrypt the admin user secret. */
  public readonly adminUserSecretKmsKey?: kms.IKey;
  /** KMS key used to encrypt the finance read-only secret. */
  private readonly financeReadonlySecretKmsKey?: kms.IKey;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    const name = (suffix: string) => `${props.resourcePrefix}-${suffix}`;

    const dbSecurityGroupId = props.dbSecurityGroupId?.trim();
    const proxySecurityGroupId = props.proxySecurityGroupId?.trim();
    const dbCredentialsSecretName = props.dbCredentialsSecretName?.trim();
    const dbCredentialsSecretArn = props.dbCredentialsSecretArn?.trim();
    const dbCredentialsSecretKmsKeyArn =
      props.dbCredentialsSecretKmsKeyArn?.trim();
    const dbAppUserSecretName = props.dbAppUserSecretName?.trim();
    const dbAppUserSecretArn = props.dbAppUserSecretArn?.trim();
    const dbAppUserSecretKmsKeyArn = props.dbAppUserSecretKmsKeyArn?.trim();
    const dbAdminUserSecretName = props.dbAdminUserSecretName?.trim();
    const dbAdminUserSecretArn = props.dbAdminUserSecretArn?.trim();
    const dbAdminUserSecretKmsKeyArn =
      props.dbAdminUserSecretKmsKeyArn?.trim();
    const dbClusterIdentifier = props.dbClusterIdentifier?.trim();
    const dbClusterEndpoint = props.dbClusterEndpoint?.trim();
    const dbClusterReaderEndpoint = props.dbClusterReaderEndpoint?.trim();
    const dbClusterPort = props.dbClusterPort ?? 5432;
    const dbProxyName = props.dbProxyName?.trim();
    const dbProxyArn = props.dbProxyArn?.trim();
    const dbProxyEndpoint = props.dbProxyEndpoint?.trim();
    this.manageSecurityGroupRules = props.manageSecurityGroupRules ?? true;
    const applyImmutableSettings = props.applyImmutableSettings ?? true;

    const useExistingCluster = Boolean(
      dbClusterIdentifier || dbClusterEndpoint || dbClusterReaderEndpoint
    );
    const useExistingProxy = Boolean(
      dbProxyName || dbProxyArn || dbProxyEndpoint
    );
    const hasAppUserSecretRef = Boolean(
      dbAppUserSecretArn || dbAppUserSecretName
    );
    const hasAdminUserSecretRef = Boolean(
      dbAdminUserSecretArn || dbAdminUserSecretName
    );

    if (useExistingCluster) {
      if (!dbClusterIdentifier || !dbClusterEndpoint) {
        throw new Error(
          "Existing DB cluster requires identifier and endpoint values."
        );
      }
      if (!dbCredentialsSecretName && !dbCredentialsSecretArn) {
        throw new Error(
          "Existing DB cluster requires DB credentials secret reference."
        );
      }
      if (!dbSecurityGroupId) {
        throw new Error("Existing DB cluster requires DB security group ID.");
      }
    }

    if (useExistingProxy) {
      if (!useExistingCluster) {
        throw new Error("Existing DB proxy requires existing DB cluster.");
      }
      if (!dbProxyName || !dbProxyArn || !dbProxyEndpoint) {
        throw new Error(
          "Existing DB proxy requires name, ARN, and endpoint values."
        );
      }
      if (!dbCredentialsSecretName && !dbCredentialsSecretArn) {
        throw new Error(
          "Existing DB proxy requires DB credentials secret reference."
        );
      }
      if (!hasAppUserSecretRef || !hasAdminUserSecretRef) {
        throw new Error(
          "Existing DB proxy requires app and admin user secret references."
        );
      }
      if (!proxySecurityGroupId) {
        throw new Error("Existing DB proxy requires proxy security group ID.");
      }
    }

    // Database security group
    this.dbSecurityGroup = dbSecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "DatabaseSecurityGroup",
          dbSecurityGroupId,
          { mutable: true }
        )
      : new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
          vpc: props.vpc,
          allowAllOutbound: true,
          securityGroupName: name("db-sg"),
          description: "Security group for Aurora database cluster",
        });

    // Proxy security group
    this.proxySecurityGroup = proxySecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "ProxySecurityGroup",
          proxySecurityGroupId,
          { mutable: true }
        )
      : new ec2.SecurityGroup(this, "ProxySecurityGroup", {
          vpc: props.vpc,
          allowAllOutbound: true,
          securityGroupName: name("proxy-sg"),
          description: "Security group for RDS Proxy",
        });

    if (this.manageSecurityGroupRules) {
      // Allow proxy to access database
      this.dbSecurityGroup.addIngressRule(
        this.proxySecurityGroup,
        ec2.Port.tcp(5432),
        "RDS Proxy access to Aurora"
      );
    }

    const needsManagedSecret =
      !dbCredentialsSecretArn && !dbCredentialsSecretName;
    const secretEncryptionKeyResource = needsManagedSecret
      ? new kms.Key(this, "DatabaseSecretKey", {
          enableKeyRotation: true,
          alias: name("database-secret-key"),
        })
      : undefined;
    const secretEncryptionKey = secretEncryptionKeyResource
      ? kms.Key.fromKeyArn(
          this,
          "DatabaseSecretKeyRef",
          secretEncryptionKeyResource.keyArn
        )
      : undefined;
    const existingSecretKmsKey = dbCredentialsSecretKmsKeyArn
      ? kms.Key.fromKeyArn(
          this,
          "DBCredentialsSecretKmsKey",
          dbCredentialsSecretKmsKeyArn
        )
      : undefined;
    const defaultSecretKmsKey = existingSecretKmsKey ?? secretEncryptionKey;

    // Database credentials secret
    const dbCredentialsSecret = dbCredentialsSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          "DBCredentialsSecret",
          dbCredentialsSecretArn
        )
      : dbCredentialsSecretName
        ? secretsmanager.Secret.fromSecretNameV2(
            this,
            "DBCredentialsSecret",
            dbCredentialsSecretName
          )
        : new secretsmanager.Secret(this, "DBCredentialsSecret", {
            secretName: name("database-credentials"),
            generateSecretString: {
              secretStringTemplate: JSON.stringify({ username: "postgres" }),
              generateStringKey: "password",
              excludePunctuation: true,
              includeSpace: false,
            },
            ...(secretEncryptionKey
              ? { encryptionKey: secretEncryptionKey }
              : {}),
          });
    this.secret = dbCredentialsSecret;
    this.secretKmsKey = existingSecretKmsKey ?? secretEncryptionKey;

    // App database user secret
    const appUserSecretKmsKey =
      dbAppUserSecretArn || dbAppUserSecretName
        ? dbAppUserSecretKmsKeyArn
          ? kms.Key.fromKeyArn(
              this,
              "DbAppUserSecretKmsKey",
              dbAppUserSecretKmsKeyArn
            )
          : undefined
        : defaultSecretKmsKey;
    const appUserSecret = dbAppUserSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          "DbAppUserSecret",
          dbAppUserSecretArn
        )
      : dbAppUserSecretName
        ? secretsmanager.Secret.fromSecretNameV2(
            this,
            "DbAppUserSecret",
            dbAppUserSecretName
          )
        : new secretsmanager.Secret(this, "DbAppUserSecret", {
            secretName: name("db-app-user-credentials"),
            generateSecretString: {
              secretStringTemplate: JSON.stringify({
                username: "evolvesprouts_app",
              }),
              generateStringKey: "password",
              excludePunctuation: true,
              includeSpace: false,
            },
            ...(appUserSecretKmsKey ? { encryptionKey: appUserSecretKmsKey } : {}),
          });
    this.appUserSecret = appUserSecret;
    this.appUserSecretKmsKey = appUserSecretKmsKey;

    // Admin database user secret
    const adminUserSecretKmsKey =
      dbAdminUserSecretArn || dbAdminUserSecretName
        ? dbAdminUserSecretKmsKeyArn
          ? kms.Key.fromKeyArn(
              this,
              "DbAdminUserSecretKmsKey",
              dbAdminUserSecretKmsKeyArn
            )
          : undefined
        : defaultSecretKmsKey;
    const adminUserSecret = dbAdminUserSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          "DbAdminUserSecret",
          dbAdminUserSecretArn
        )
      : dbAdminUserSecretName
        ? secretsmanager.Secret.fromSecretNameV2(
            this,
            "DbAdminUserSecret",
            dbAdminUserSecretName
          )
        : new secretsmanager.Secret(this, "DbAdminUserSecret", {
            secretName: name("db-admin-user-credentials"),
            generateSecretString: {
              secretStringTemplate: JSON.stringify({
                username: "evolvesprouts_admin",
              }),
              generateStringKey: "password",
              excludePunctuation: true,
              includeSpace: false,
            },
            ...(adminUserSecretKmsKey
              ? { encryptionKey: adminUserSecretKmsKey }
              : {}),
          });
    this.adminUserSecret = adminUserSecret;
    this.adminUserSecretKmsKey = adminUserSecretKmsKey;

    // Password login for the external finance mirror (Aurora Data API).
    // This secret stays off the RDS Proxy. evolvesprouts_app cannot be reused:
    // GRANT rds_iam blocks the password login the Data API requires.
    const financeReadonlySecret = new secretsmanager.Secret(
      this,
      "DbFinanceReadonlySecret",
      {
        secretName: name("db-finance-readonly-credentials"),
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: "evolvesprouts_finance_ro",
          }),
          generateStringKey: "password",
          excludePunctuation: true,
          includeSpace: false,
        },
        ...(defaultSecretKmsKey ? { encryptionKey: defaultSecretKmsKey } : {}),
      }
    );
    this.financeReadonlySecret = financeReadonlySecret;
    this.financeReadonlySecretKmsKey = defaultSecretKmsKey;

    // Aurora PostgreSQL Serverless v2 cluster
    if (useExistingCluster) {
      const readerEndpoint = dbClusterReaderEndpoint ?? dbClusterEndpoint;
      this.cluster = rds.DatabaseCluster.fromDatabaseClusterAttributes(
        this,
        "Cluster",
        {
          clusterIdentifier: dbClusterIdentifier!,
          clusterEndpointAddress: dbClusterEndpoint!,
          readerEndpointAddress: readerEndpoint!,
          port: dbClusterPort,
          securityGroups: [this.dbSecurityGroup],
        }
      );
    } else {
      const monitoringRole = new iam.Role(this, "DatabaseMonitoringRole", {
        assumedBy: new iam.ServicePrincipal("monitoring.rds.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonRDSEnhancedMonitoringRole"
          ),
        ],
      });
      const writerInstance = rds.ClusterInstance.serverlessV2("writer", {
        instanceIdentifier: name("db-writer"),
      });
      const cluster = new rds.DatabaseCluster(this, "Cluster", {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_4,
        }),
        cloudwatchLogsExports: ["postgresql"],
        // Standard 90-day retention for database logs
        cloudwatchLogsRetention: STANDARD_LOG_RETENTION,
        credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
        defaultDatabaseName: props.databaseName ?? "evolvesprouts",
        // IMPORTANT: iamAuthentication must be false on the cluster to allow
        // password-based connections for migrations. IAM auth is handled by
        // RDS Proxy for Lambda app connections. Setting this to true causes
        // "PAM authentication failed" errors for direct password connections.
        iamAuthentication: false,
        // Keep on: the external finance mirror reads through the Data API,
        // and omitting the flag would switch the endpoint off on deploy.
        enableDataApi: true,
        // Always set storageEncrypted: true - encryption cannot be disabled
        // after cluster creation, and setting to undefined on subsequent
        // deployments would cause CloudFormation to attempt replacement.
        storageEncrypted: true,
        // RELIABILITY: automated backups and deletion protection guard
        // against accidental data loss from stack operations.
        backup: {
          retention: cdk.Duration.days(props.backupRetentionDays ?? 14),
        },
        copyTagsToSnapshot: true,
        deletionProtection: props.deletionProtection ?? true,
        serverlessV2MinCapacity: props.minCapacity ?? 0.5,
        serverlessV2MaxCapacity: props.maxCapacity ?? 2,
        writer: writerInstance,
        clusterIdentifier: name("db-cluster"),
        vpc: props.vpc,
        // Select private subnets - works with both NAT Gateway and VPC Endpoints
        vpcSubnets: selectPrivateSubnets(props.vpc),
        securityGroups: [this.dbSecurityGroup],
      });
      this.cluster = cluster;

      for (const child of cluster.node.findAll()) {
        if (child instanceof rds.CfnDBInstance) {
          child.monitoringInterval = 60;
          child.monitoringRoleArn = monitoringRole.roleArn;
        }
      }
    }

    // RDS Proxy for connection pooling and IAM auth
    if (useExistingProxy) {
      this.proxy = rds.DatabaseProxy.fromDatabaseProxyAttributes(this, "Proxy", {
        dbProxyName: dbProxyName!,
        dbProxyArn: dbProxyArn!,
        endpoint: dbProxyEndpoint!,
        securityGroups: [this.proxySecurityGroup],
      });
    } else {
      this.proxy = new rds.DatabaseProxy(this, "Proxy", {
        proxyTarget: rds.ProxyTarget.fromCluster(this.cluster),
        secrets: [dbCredentialsSecret, appUserSecret, adminUserSecret],
        vpc: props.vpc,
        securityGroups: [this.proxySecurityGroup],
        requireTLS: true,
        iamAuth: true,
        dbProxyName: name("db-proxy"),
      });
    }
  }

  /**
   * Allow a security group to access the RDS Proxy.
   */
  public allowFrom(securityGroup: ec2.ISecurityGroup, description: string): void {
    if (!this.manageSecurityGroupRules) {
      return;
    }
    this.proxySecurityGroup.addIngressRule(
      securityGroup,
      ec2.Port.tcp(5432),
      description
    );
  }

  /**
   * Allow direct database access (for migrations).
   */
  public allowDirectAccessFrom(
    securityGroup: ec2.ISecurityGroup,
    description: string
  ): void {
    if (!this.manageSecurityGroupRules) {
      return;
    }
    this.dbSecurityGroup.addIngressRule(
      securityGroup,
      ec2.Port.tcp(5432),
      description
    );
  }

  /**
   * Grant a Lambda function permission to connect via RDS Proxy.
   */
  public grantConnect(fn: cdk.aws_lambda.IFunction, dbUser: string): void {
    this.proxy.grantConnect(fn, dbUser);
  }

  /**
   * Grant a Lambda function permission to read the database secret.
   */
  public grantSecretRead(fn: cdk.aws_lambda.IFunction): void {
    this.secret.grantRead(fn);
    if (this.secretKmsKey) {
      this.secretKmsKey.grantDecrypt(fn);
    }
  }

  /**
   * Grant a Lambda function permission to read the app user secret.
   */
  public grantAppUserSecretRead(fn: cdk.aws_lambda.IFunction): void {
    this.appUserSecret.grantRead(fn);
    if (this.appUserSecretKmsKey) {
      this.appUserSecretKmsKey.grantDecrypt(fn);
    }
  }

  /**
   * Grant a Lambda function permission to read the admin user secret.
   */
  public grantAdminUserSecretRead(fn: cdk.aws_lambda.IFunction): void {
    this.adminUserSecret.grantRead(fn);
    if (this.adminUserSecretKmsKey) {
      this.adminUserSecretKmsKey.grantDecrypt(fn);
    }
  }

  /**
   * Grant a Lambda function permission to read the finance read-only secret.
   */
  public grantFinanceReadonlySecretRead(fn: cdk.aws_lambda.IFunction): void {
    this.financeReadonlySecret.grantRead(fn);
    if (this.financeReadonlySecretKmsKey) {
      this.financeReadonlySecretKmsKey.grantDecrypt(fn);
    }
  }
}
