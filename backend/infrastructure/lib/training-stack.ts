import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import {
  API_MEDIA_REQUEST_PROXY_FUNCTION,
  API_PROXY_ALLOWLIST_FUNCTION,
  STATIC_EXPORT_PATH_REWRITE_FUNCTION,
  WWW_API_ERROR_RESPONSE_FUNCTION,
} from "./cloudfront-www-proxy-functions";

const API_BASE_URL_PATTERN = "^https://[^/]+/?$";

const TRAINING_HEADER_CONTENT_SECURITY_POLICY = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const TRAINING_PERMISSIONS_POLICY =
  "accelerometer=(), camera=(), geolocation=(), gyroscope=(), " +
  "magnetometer=(), microphone=(), payment=(), usb=()";

const TRAINING_BUCKET_PREFIX = "evolvesprouts-training";
const TRAINING_LOG_BUCKET_PREFIX = "evolvesprouts-training-logs";

export class TrainingStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly loggingBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Organization", "Evolve Sprouts");
    cdk.Tags.of(this).add("Project", "Training Website");

    const domainName = new cdk.CfnParameter(this, "TrainingDomainName", {
      type: "String",
      description: "Custom domain for training website (CloudFront alias).",
    });

    const certificateArn = new cdk.CfnParameter(this, "TrainingCertificateArn", {
      type: "String",
      description: "ACM certificate ARN for training website domain.",
    });

    const trainingApiBaseUrl = new cdk.CfnParameter(this, "TrainingApiBaseUrl", {
      type: "String",
      description:
        "Absolute HTTPS public API origin for the /api proxy (for example https://api.example.com). A path such as /prod is rejected.",
      allowedPattern: API_BASE_URL_PATTERN,
      constraintDescription:
        "Must be an absolute HTTPS origin with an empty path or a trailing slash.",
    });

    const trainingMediaRequestApiBaseUrl = new cdk.CfnParameter(
      this,
      "TrainingMediaRequestApiBaseUrl",
      {
        type: "String",
        description:
          "Absolute HTTPS API origin for media requests (for example https://api.example.com). A path such as /prod is rejected.",
        allowedPattern: API_BASE_URL_PATTERN,
        constraintDescription:
          "Must be an absolute HTTPS origin with an empty path or a trailing slash.",
      },
    );

    const apiOriginDomainName = resolveApiOriginDomainName(
      trainingApiBaseUrl.valueAsString,
    );
    const apiOriginPath = resolveApiOriginPath(
      this,
      "TrainingApiOriginHasPath",
      trainingApiBaseUrl.valueAsString,
    );
    const mediaRequestApiOriginDomainName = resolveApiOriginDomainName(
      trainingMediaRequestApiBaseUrl.valueAsString,
    );
    const mediaRequestApiOriginPath = resolveApiOriginPath(
      this,
      "TrainingMediaRequestApiOriginHasPath",
      trainingMediaRequestApiBaseUrl.valueAsString,
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

    const loggingBucketName = [
      TRAINING_LOG_BUCKET_PREFIX,
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    this.loggingBucket = new s3.Bucket(this, "TrainingLoggingBucket", {
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

    const loggingBucketCfn = this.loggingBucket.node.defaultChild as s3.CfnBucket;
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
      TRAINING_BUCKET_PREFIX,
      cdk.Aws.ACCOUNT_ID,
      cdk.Aws.REGION,
    ].join("-");

    this.bucket = new s3.Bucket(this, "TrainingBucket", {
      bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverAccessLogsBucket: this.loggingBucket,
      serverAccessLogsPrefix: "s3-access-logs/",
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "TrainingOai",
      {
        comment: "OAI for training website CloudFront distribution.",
      },
    );
    this.bucket.grantRead(originAccessIdentity);

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "TrainingCertificate",
      certificateArn.valueAsString,
    );

    const websiteOrigin = origins.S3BucketOrigin.withOriginAccessIdentity(
      this.bucket,
      {
        originAccessIdentity,
      },
    );
    const wwwApiOrigin = new origins.HttpOrigin(apiOriginDomainName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: apiOriginPath,
    });
    const mediaRequestApiOrigin = new origins.HttpOrigin(
      mediaRequestApiOriginDomainName,
      {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        originPath: mediaRequestApiOriginPath,
      },
    );

    const pathRewriteFunction = new cloudfront.Function(
      this,
      "TrainingPathRewriteFunction",
      {
        comment:
          "Rewrite extensionless and trailing-slash paths to index.html for static export.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(
          STATIC_EXPORT_PATH_REWRITE_FUNCTION,
        ),
      },
    );

    const wwwApiErrorResponseFunction = new cloudfront.Function(
      this,
      "TrainingWwwApiErrorResponseFunction",
      {
        comment:
          "Convert HTML error pages to JSON for /www API proxy behaviors.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(WWW_API_ERROR_RESPONSE_FUNCTION),
      },
    );

    const apiProxyAllowlistFunction = new cloudfront.Function(
      this,
      "TrainingApiProxyAllowlistFunction",
      {
        comment:
          "Allow only explicitly approved public API method/path pairs on /api/*.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(API_PROXY_ALLOWLIST_FUNCTION),
      },
    );
    const apiMediaRequestProxyFunction = new cloudfront.Function(
      this,
      "TrainingApiMediaRequestProxyFunction",
      {
        comment:
          "Allow /api/v1/public/assets/free/request and rewrite the path for the API origin.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(API_MEDIA_REQUEST_PROXY_FUNCTION),
      },
    );

    wwwApiErrorResponseFunction.node.addDependency(pathRewriteFunction);
    apiProxyAllowlistFunction.node.addDependency(wwwApiErrorResponseFunction);
    apiMediaRequestProxyFunction.node.addDependency(apiProxyAllowlistFunction);

    const apiProxyCachePolicy = new cloudfront.CachePolicy(
      this,
      "TrainingApiProxyCachePolicy",
      {
        cachePolicyName: "training-api-proxy-cache",
        comment:
          "Edge cache for allowlisted /api/* GETs; TTL from origin Cache-Control (cap 15m).",
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
      "TrainingResponseHeadersPolicy",
      {
        comment: "Security headers for training website distribution.",
        customHeadersBehavior: {
          customHeaders: [
            {
              header: "Permissions-Policy",
              value: TRAINING_PERMISSIONS_POLICY,
              override: true,
            },
            {
              header: "X-Robots-Tag",
              value: "noindex, nofollow, noarchive",
              override: true,
            },
          ],
        },
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            contentSecurityPolicy: TRAINING_HEADER_CONTENT_SECURITY_POLICY,
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

    this.distribution = new cloudfront.Distribution(this, "TrainingDistribution", {
      defaultRootObject: "index.html",
      domainNames: [domainName.valueAsString],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableLogging: true,
      logBucket: this.loggingBucket,
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
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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
        "api/v1/public/assets/free/request": {
          origin: mediaRequestApiOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: apiMediaRequestProxyFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
            {
              function: wwwApiErrorResponseFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
        },
        "api/*": {
          origin: wwwApiOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: apiProxyCachePolicy,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: apiProxyAllowlistFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
            {
              function: wwwApiErrorResponseFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
        },
      },
    });

    const cfnDistribution =
      this.distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride(
      "DistributionConfig.WebACLId",
      cdk.Fn.conditionIf(
        hasWafWebAclArn.logicalId,
        wafWebAclArn.valueAsString,
        cdk.Aws.NO_VALUE,
      ),
    );

    new cdk.CfnOutput(this, "TrainingBucketName", {
      value: this.bucket.bucketName,
    });

    new cdk.CfnOutput(this, "TrainingDistributionId", {
      value: this.distribution.distributionId,
    });

    new cdk.CfnOutput(this, "TrainingDistributionDomain", {
      value: this.distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, "TrainingLoggingBucketName", {
      value: this.loggingBucket.bucketName,
      description: "S3 bucket for CloudFront and S3 access logs",
    });
  }
}

function resolveApiOriginDomainName(apiBaseUrl: string): string {
  return cdk.Fn.select(
    0,
    cdk.Fn.split("/", cdk.Fn.select(1, cdk.Fn.split("://", apiBaseUrl))),
  );
}

function resolveApiOriginPath(
  scope: cdk.Stack,
  id: string,
  apiBaseUrl: string,
): string {
  const afterScheme = cdk.Fn.select(1, cdk.Fn.split("://", apiBaseUrl));
  const segment = cdk.Fn.select(
    1,
    cdk.Fn.split("/", cdk.Fn.join("", [afterScheme, "/"])),
  );
  const hasPath = new cdk.CfnCondition(scope, id, {
    expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(segment, "")),
  });
  return cdk.Token.asString(
    cdk.Fn.conditionIf(hasPath.logicalId, cdk.Fn.join("", ["/", segment]), ""),
  );
}
