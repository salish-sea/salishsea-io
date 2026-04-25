import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import * as path from 'path';

const ACCOUNT_ID = '648183724555';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda@Edge function — automatically provisioned in us-east-1 regardless of stack region
    const ogFunction = new cloudfront.experimental.EdgeFunction(this, 'OgMetaFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'edge-handler')),
      // DO NOT set environment — Lambda@Edge does not support environment variables
      // 5s is the maximum for viewer-request; needed for cross-region SSM + Supabase fetch
      timeout: cdk.Duration.seconds(5),
      logRetention: logs.RetentionDays.THREE_MONTHS,
    });

    // SSM parameters for Supabase credentials
    new ssm.StringParameter(this, 'SupabaseUrl', {
      parameterName: '/salishsea/supabase-url',
      stringValue: 'https://grztmjpzamcxlzecmqca.supabase.co',
    });

    // Anon key: written from CDK context on each deploy, retained on stack deletion so
    // the value is never lost. CFN only supports String type; the Lambda reads it fine.
    // To deploy: pass --context supabaseAnonKey=<value> (done by deploy.yml via SUPABASE_ANON_KEY env).
    const anonKeyParam = new ssm.StringParameter(this, 'SupabaseAnonKey', {
      parameterName: '/salishsea/supabase-anon-key',
      stringValue: this.node.tryGetContext('supabaseAnonKey') ?? 'placeholder-set-in-aws-console',
    });
    anonKeyParam.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // IAM: grant Lambda@Edge read access to SSM parameters in us-east-1
    ogFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:us-east-1:${ACCOUNT_ID}:parameter/salishsea/*`],
    }));

    // S3 bucket for CloudFront access logs
    const logBucket = new s3.Bucket(this, 'LogBucket', {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // S3 origin — bucket already exists in production; import by name
    const siteBucket = s3.Bucket.fromBucketName(this, 'SiteBucket', 'salishsea-io');
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(siteBucket, {
      originPath: '/site',
    });

    // CloudFront Distribution — reconstructed to match production config
    new cloudfront.Distribution(this, 'SalishSeaDist', {
      logBucket,
      logFilePrefix: 'cloudfront/',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      domainNames: ['salishsea.io'],
      certificate: acm.Certificate.fromCertificateArn(
        this, 'Cert',
        `arn:aws:acm:us-east-1:${ACCOUNT_ID}:certificate/8cfdef8d-648b-42ba-a525-045f7b1a7762`,
      ),
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.fromCachePolicyId(
          this, 'CachePolicy', '658327ea-f89d-4fab-a63d-7e88639e58f6',
        ),
        edgeLambdas: [
          {
            functionVersion: ogFunction.currentVersion,
            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
          },
        ],
      },
    });
  }
}
