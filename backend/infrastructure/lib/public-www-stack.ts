import * as fs from "node:fs";
import * as path from "node:path";

import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import {
  MEDIA_REQUEST_PROXY_FUNCTION,
  STATIC_EXPORT_PATH_REWRITE_FUNCTION,
  WWW_API_ERROR_RESPONSE_FUNCTION,
  WWW_PROXY_ALLOWLIST_FUNCTION,
} from "./cloudfront-www-proxy-functions";

// Secrets are spliced into CloudFront Function source as JS string literals,
// so the allowed alphabet excludes quotes and backslashes. Minimum 32 chars.
const EDGE_VERIFY_SECRET_PATTERN = "^$|^[A-Za-z0-9+/=_-]{32,}$";
const EDGE_VERIFY_SNIPPET = fs.readFileSync(
  path.join(__dirname, "functions/public-www-edge-verify.js"),
  "utf8",
);
const REQUEST_BINDING = "var request = event.request;";

interface EdgeVerifySecrets {
  readonly current: string;
  readonly previous: string;
}

/**
 * Prepend the edge-verify check to a viewer-request function body. The
 * placeholders resolve to CloudFormation parameter references at deploy.
 * Both values empty makes edgeVerifyRejection return null for every request.
 */
export function withEdgeVerify(body: string, secrets: EdgeVerifySecrets): string {
  const snippet = EDGE_VERIFY_SNIPPET.replace(
    "__EDGE_VERIFY_SECRET__",
    secrets.current,
  ).replace("__EDGE_VERIFY_SECRET_PREVIOUS__", secrets.previous);
  return `${snippet}\n${body}`;
}

const EDGE_VERIFY_CALL = [
  "  var rejection = edgeVerifyRejection(request);",
  "  if (rejection) {",
  "    return rejection;",
  "  }",
].join("\n");

/**
 * Insert the rejection call immediately after the only viewer-request binding.
 * More than one binding is rejected so a later edit cannot hide the call.
 */
export function insertEdgeVerifyCall(body: string): string {
  const occurrences = body.split(REQUEST_BINDING).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `viewer-request function must contain \`${REQUEST_BINDING}\` exactly once, found ${occurrences}`,
    );
  }
  return body.replace(REQUEST_BINDING, `${REQUEST_BINDING}\n${EDGE_VERIFY_CALL}`);
}

/** Insert the rejection call, then prepend the snippet. */
export function viewerRequestSource(
  body: string,
  secrets: EdgeVerifySecrets,
): string {
  return withEdgeVerify(insertEdgeVerifyCall(body), secrets);
}

interface WebsiteEnvironmentConfig {
  readonly idPrefix: "PublicWww" | "PublicWwwStaging";
  readonly environmentLabel: "production" | "staging";
  readonly domainName: string;
  readonly certificateArn: string;
  readonly apiOriginDomainName: string;
  readonly apiOriginPath: string;
  readonly mediaRequestApiOriginDomainName: string;
  readonly mediaRequestApiOriginPath: string;
  readonly bucketNamePrefix: string;
  readonly loggingBucketNamePrefix: string;
  readonly addNoIndexHeader: boolean;
  readonly hasWafWebAclArn: cdk.CfnCondition;
  readonly wafWebAclArn: cdk.CfnParameter;
  readonly edgeVerifySecrets: EdgeVerifySecrets;
}

interface WebsiteEnvironmentResources {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  readonly loggingBucket: s3.Bucket;
}

const PUBLIC_WWW_HEADER_CONTENT_SECURITY_POLICY = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const STRIPE_JS_ORIGIN = "https://js.stripe.com";

const PUBLIC_WWW_PERMISSIONS_POLICY =
  "accelerometer=(), camera=(), geolocation=(), gyroscope=(), " +
  `magnetometer=(), microphone=(), payment=(self "${STRIPE_JS_ORIGIN}"), usb=()`;

export class PublicWwwStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly loggingBucket: s3.Bucket;
  public readonly stagingBucket: s3.Bucket;
  public readonly stagingDistribution: cloudfront.Distribution;
  public readonly stagingLoggingBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "Evolve Sprouts");
    cdk.Tags.of(this).add("Project", "Public Website");

    const productionDomainName = new cdk.CfnParameter(this, "PublicWwwDomainName", {
      type: "String",
      description: "Custom domain for production public website (CloudFront alias).",
    });

    const productionCertificateArn = new cdk.CfnParameter(
      this,
      "PublicWwwCertificateArn",
      {
        type: "String",
        description: "ACM certificate ARN for production public website domain.",
      },
    );

    const stagingDomainName = new cdk.CfnParameter(
      this,
      "PublicWwwStagingDomainName",
      {
        type: "String",
        description: "Custom domain for staging public website (CloudFront alias).",
      },
    );

    const stagingCertificateArn = new cdk.CfnParameter(
      this,
      "PublicWwwStagingCertificateArn",
      {
        type: "String",
        description: "ACM certificate ARN for staging public website domain.",
      },
    );
    const publicWwwApiBaseUrl = new cdk.CfnParameter(
      this,
      "PublicWwwApiBaseUrl",
      {
        type: "String",
        description:
          "Absolute HTTPS public API base URL used by the /www proxy (for example https://api.example.com/prod or https://api.example.com/www).",
        allowedPattern: "^https://[^/]+/[^/]+/?$",
        constraintDescription:
          "Must be an absolute HTTPS URL ending in a single path segment (for example /prod or /www).",
      },
    );
    const publicWwwApiOriginDomainName = resolveApiOriginDomainName(
      publicWwwApiBaseUrl.valueAsString,
    );
    const publicWwwApiOriginPath = resolveApiOriginPath(
      publicWwwApiBaseUrl.valueAsString,
    );
    const publicWwwMediaRequestApiBaseUrl = new cdk.CfnParameter(
      this,
      "PublicWwwMediaRequestApiBaseUrl",
      {
        type: "String",
        description:
          "Absolute HTTPS API base URL for media requests (for example https://api.example.com/prod).",
        allowedPattern: "^https://[^/]+/[^/]+/?$",
        constraintDescription:
          "Must be an absolute HTTPS URL ending in a single stage path segment (for example /prod).",
      },
    );
    const publicWwwMediaRequestApiOriginDomainName = resolveApiOriginDomainName(
      publicWwwMediaRequestApiBaseUrl.valueAsString,
    );
    const publicWwwMediaRequestApiOriginPath = resolveApiOriginPath(
      publicWwwMediaRequestApiBaseUrl.valueAsString,
    );

    const wafWebAclArn = new cdk.CfnParameter(this, "WafWebAclArn", {
      type: "String",
      default: "",
      description:
        "WAF WebACL ARN for CloudFront protection (must be from us-east-1).",
      allowedPattern: "^$|arn:aws:wafv2:us-east-1:[0-9]+:global/webacl/.+$",
      constraintDescription:
        "Must be empty or a valid WAF WebACL ARN from us-east-1.",
    });
    const hasWafWebAclArn = new cdk.CfnCondition(this, "HasWafWebAclArn", {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionEquals(wafWebAclArn.valueAsString, ""),
      ),
    });
    const productionEdgeVerify = this.createEdgeVerifyParameters("PublicWww");
    const stagingEdgeVerify = this.createEdgeVerifyParameters("PublicWwwStaging");

    const productionResources = this.createWebsiteEnvironment({
      idPrefix: "PublicWww",
      environmentLabel: "production",
      domainName: productionDomainName.valueAsString,
      certificateArn: productionCertificateArn.valueAsString,
      apiOriginDomainName: publicWwwApiOriginDomainName,
      apiOriginPath: publicWwwApiOriginPath,
      mediaRequestApiOriginDomainName: publicWwwMediaRequestApiOriginDomainName,
      mediaRequestApiOriginPath: publicWwwMediaRequestApiOriginPath,
      bucketNamePrefix: "evolvesprouts-public-www",
      loggingBucketNamePrefix: "evolvesprouts-public-www-logs",
      addNoIndexHeader: false,
      hasWafWebAclArn,
      wafWebAclArn,
      edgeVerifySecrets: productionEdgeVerify,
    });
    this.bucket = productionResources.bucket;
    this.distribution = productionResources.distribution;
    this.loggingBucket = productionResources.loggingBucket;

    const stagingResources = this.createWebsiteEnvironment({
      idPrefix: "PublicWwwStaging",
      environmentLabel: "staging",
      domainName: stagingDomainName.valueAsString,
      certificateArn: stagingCertificateArn.valueAsString,
      apiOriginDomainName: publicWwwApiOriginDomainName,
      apiOriginPath: publicWwwApiOriginPath,
      mediaRequestApiOriginDomainName: publicWwwMediaRequestApiOriginDomainName,
      mediaRequestApiOriginPath: publicWwwMediaRequestApiOriginPath,
      bucketNamePrefix: "evolvesprouts-staging-www",
      loggingBucketNamePrefix: "evolvesprouts-staging-www-logs",
      addNoIndexHeader: true,
      hasWafWebAclArn,
      wafWebAclArn,
      edgeVerifySecrets: stagingEdgeVerify,
    });
    this.stagingBucket = stagingResources.bucket;
    this.stagingDistribution = stagingResources.distribution;
    this.stagingLoggingBucket = stagingResources.loggingBucket;

    new cdk.CfnOutput(this, "PublicWwwBucketName", {
      value: this.bucket.bucketName,
    });

    new cdk.CfnOutput(this, "PublicWwwDistributionId", {
      value: this.distribution.distributionId,
    });

    new cdk.CfnOutput(this, "PublicWwwDistributionDomain", {
      value: this.distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, "PublicWwwLoggingBucketName", {
      value: this.loggingBucket.bucketName,
      description: "S3 bucket for CloudFront and S3 access logs",
    });

    new cdk.CfnOutput(this, "PublicWwwStagingBucketName", {
      value: this.stagingBucket.bucketName,
    });

    new cdk.CfnOutput(this, "PublicWwwStagingDistributionId", {
      value: this.stagingDistribution.distributionId,
    });

    new cdk.CfnOutput(this, "PublicWwwStagingDistributionDomain", {
      value: this.stagingDistribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, "PublicWwwStagingLoggingBucketName", {
      value: this.stagingLoggingBucket.bucketName,
      description: "S3 bucket for staging CloudFront and S3 access logs",
    });
  }

  private createEdgeVerifyParameters(
    idPrefix: "PublicWww" | "PublicWwwStaging",
  ): EdgeVerifySecrets {
    const label = idPrefix === "PublicWwwStaging" ? "staging" : "production";
    const current = new cdk.CfnParameter(this, `${idPrefix}EdgeVerifySecret`, {
      type: "String",
      noEcho: true,
      default: "",
      allowedPattern: EDGE_VERIFY_SECRET_PATTERN,
      description:
        `Origin-lock secret for the ${label} public website. ` +
        "Viewer requests without a matching x-proxy-verify header are refused. " +
        "Empty disables the check. When set: 32+ chars of [A-Za-z0-9+/=_-].",
    });
    const previous = new cdk.CfnParameter(
      this,
      `${idPrefix}EdgeVerifySecretPrevious`,
      {
        type: "String",
        noEcho: true,
        default: "",
        allowedPattern: EDGE_VERIFY_SECRET_PATTERN,
        description:
          `Previous ${label} edge-verify secret, accepted during rotation. ` +
          "Clear it once the proxy sends only the new value.",
      },
    );
    const hasSecret = new cdk.CfnCondition(this, `Has${idPrefix}EdgeVerifySecret`, {
      expression: cdk.Fn.conditionNot(
        cdk.Fn.conditionAnd(
          cdk.Fn.conditionEquals(current.valueAsString, ""),
          cdk.Fn.conditionEquals(previous.valueAsString, ""),
        ),
      ),
    });
    // The condition has to be referenced or CloudFormation validation warns
    // that it is unused. There is no WebACL to detach, so the output is the
    // reference. "true" means this distribution's functions are enforcing.
    new cdk.CfnOutput(this, `${idPrefix}EdgeVerifyEnabled`, {
      value: cdk.Token.asString(
        cdk.Fn.conditionIf(hasSecret.logicalId, "true", "false"),
      ),
      description: `true when the ${label} public website origin lock is enforcing.`,
    });
    return {
      current: current.valueAsString,
      previous: previous.valueAsString,
    };
  }

  private viewerRequestCode(
    body: string,
    config: WebsiteEnvironmentConfig,
  ): string {
    return viewerRequestSource(body, config.edgeVerifySecrets);
  }

  private createWebsiteEnvironment(
    config: WebsiteEnvironmentConfig,
  ): WebsiteEnvironmentResources {
    const loggingBucketName = [
      config.loggingBucketNamePrefix,
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    const loggingBucket = new s3.Bucket(this, `${config.idPrefix}LoggingBucket`, {
      bucketName: loggingBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "ExpireOldLogs",
          enabled: true,
          expiration: cdk.Duration.days(90),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
    });

    const loggingBucketCfn = loggingBucket.node.defaultChild as s3.CfnBucket;
    loggingBucketCfn.addMetadata("checkov", {
      skip: [
        {
          id: "CKV_AWS_18",
          comment:
            "Logging bucket cannot have self-logging without recursion.",
        },
      ],
    });

    const bucketName = [
      config.bucketNamePrefix,
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");
    const bucket = new s3.Bucket(this, `${config.idPrefix}Bucket`, {
      bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverAccessLogsBucket: loggingBucket,
      serverAccessLogsPrefix: "s3-access-logs/",
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      `${config.idPrefix}Oai`,
      {
        comment: `OAI for ${config.environmentLabel} public website CloudFront distribution.`,
      },
    );
    bucket.grantRead(originAccessIdentity);

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      `${config.idPrefix}Certificate`,
      config.certificateArn,
    );

    const websiteOrigin = origins.S3BucketOrigin.withOriginAccessIdentity(bucket, {
      originAccessIdentity,
    });
    const wwwApiOrigin = new origins.HttpOrigin(config.apiOriginDomainName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: config.apiOriginPath,
    });
    const mediaRequestApiOrigin = new origins.HttpOrigin(
      config.mediaRequestApiOriginDomainName,
      {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        originPath: config.mediaRequestApiOriginPath,
      },
    );
    const pathRewriteFunction = new cloudfront.Function(
      this,
      `${config.idPrefix}PathRewriteFunction`,
      {
        comment:
          "Edge-verify, then rewrite extensionless and trailing-slash paths to index.html.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(
          this.viewerRequestCode(STATIC_EXPORT_PATH_REWRITE_FUNCTION, config),
        ),
      },
    );
    const wwwProxyAllowlistFunction = new cloudfront.Function(
      this,
      `${config.idPrefix}WwwProxyAllowlistFunction`,
      {
        comment:
          "Edge-verify, then allow only approved public API method/path pairs on /www/*.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(
          this.viewerRequestCode(WWW_PROXY_ALLOWLIST_FUNCTION, config),
        ),
      },
    );
    const mediaRequestProxyFunction = new cloudfront.Function(
      this,
      `${config.idPrefix}MediaRequestProxyFunction`,
      {
        comment:
          "Edge-verify, then allow /www/v1/assets/free/request and rewrite the path.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(
          this.viewerRequestCode(MEDIA_REQUEST_PROXY_FUNCTION, config),
        ),
      },
    );
    const wwwApiErrorResponseFunction = new cloudfront.Function(
      this,
      `${config.idPrefix}WwwApiErrorResponseFunction`,
      {
        comment:
          "Convert HTML error pages to JSON for /www API proxy behaviors.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(WWW_API_ERROR_RESPONSE_FUNCTION),
      },
    );
    // Serialize CloudFront Function updates inside this environment so
    // CloudFormation does not exhaust the regional CloudFront Functions API
    // rate limit. Without this chain, CDK schedules all four updates in
    // parallel and AWS returns ``Limit exceeded ... Reason: Rate exceeded``
    // (``ServiceLimitExceeded``), rolling the stack back. Production and
    // staging environments still run in parallel with each other (2-way
    // concurrency stays under the throttle); chain order is otherwise
    // arbitrary because none of these functions reference each other.
    wwwProxyAllowlistFunction.node.addDependency(pathRewriteFunction);
    mediaRequestProxyFunction.node.addDependency(wwwProxyAllowlistFunction);
    wwwApiErrorResponseFunction.node.addDependency(mediaRequestProxyFunction);

    const customHeaders: cloudfront.ResponseCustomHeader[] = [
      {
        header: "Permissions-Policy",
        value: PUBLIC_WWW_PERMISSIONS_POLICY,
        override: true,
      },
    ];
    if (config.addNoIndexHeader) {
      customHeaders.push({
        header: "X-Robots-Tag",
        value: "noindex, nofollow, noarchive",
        override: true,
      });
    }

    const apiProxyCachePolicy = new cloudfront.CachePolicy(
      this,
      `${config.idPrefix}ApiProxyCachePolicy`,
      {
        cachePolicyName: `${config.idPrefix.toLowerCase()}-api-proxy-cache`,
        comment:
          "Edge cache for allowlisted /www/* GETs; TTL from origin Cache-Control (cap 15m).",
        defaultTtl: cdk.Duration.minutes(5),
        minTtl: cdk.Duration.seconds(0),
        maxTtl: cdk.Duration.minutes(15),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      },
    );

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      `${config.idPrefix}ResponseHeadersPolicy`,
      {
        comment: `Security headers for ${config.environmentLabel} public website distribution.`,
        customHeadersBehavior:
          customHeaders.length > 0
            ? {
                customHeaders,
              }
            : undefined,
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            contentSecurityPolicy: PUBLIC_WWW_HEADER_CONTENT_SECURITY_POLICY,
            override: true,
          },
          contentTypeOptions: {
            override: true,
          },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.days(365),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          xssProtection: {
            protection: true,
            modeBlock: true,
            override: true,
          },
        },
      },
    );

    const distribution = new cloudfront.Distribution(
      this,
      `${config.idPrefix}Distribution`,
      {
        defaultRootObject: "index.html",
        domainNames: [config.domainName],
        certificate,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        enableLogging: true,
        logBucket: loggingBucket,
        logFilePrefix: "cloudfront-access-logs/",
        logIncludesCookies: false,
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: cdk.Duration.minutes(1),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: cdk.Duration.minutes(1),
          },
        ],
        defaultBehavior: {
          origin: websiteOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy,
          functionAssociations: [
            {
              function: pathRewriteFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        additionalBehaviors: {
          "www/v1/assets/free/request": {
            origin: mediaRequestApiOrigin,
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy:
              cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            functionAssociations: [
              {
                function: mediaRequestProxyFunction,
                eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
              },
              {
                function: wwwApiErrorResponseFunction,
                eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
              },
            ],
          },
          "www/*": {
            origin: wwwApiOrigin,
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: apiProxyCachePolicy,
            originRequestPolicy:
              cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            functionAssociations: [
              {
                function: wwwProxyAllowlistFunction,
                eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
              },
              {
                function: wwwApiErrorResponseFunction,
                eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
              },
            ],
          },
        },
      },
    );
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    // WafWebAclArn is empty and neither distribution attaches a WebACL, so
    // there is no WAF to detach when the origin lock turns on. A later WebACL
    // must use HasWafWebAclArn AND NOT Has<Prefix>EdgeVerifySecret, or the
    // shared rate rule will count every viewer as a Cloudflare egress IP.
    cfnDistribution.addPropertyOverride(
      "DistributionConfig.WebACLId",
      cdk.Fn.conditionIf(
        config.hasWafWebAclArn.logicalId,
        config.wafWebAclArn.valueAsString,
        cdk.Aws.NO_VALUE,
      ),
    );

    return {
      bucket,
      distribution,
      loggingBucket,
    };
  }
}

function resolveApiOriginDomainName(apiBaseUrl: string): string {
  return cdk.Fn.select(
    0,
    cdk.Fn.split("/", cdk.Fn.select(1, cdk.Fn.split("://", apiBaseUrl))),
  );
}

function resolveApiOriginPath(apiBaseUrl: string): string {
  return `/${cdk.Fn.select(
    1,
    cdk.Fn.split("/", cdk.Fn.select(1, cdk.Fn.split("://", apiBaseUrl))),
  )}`;
}
