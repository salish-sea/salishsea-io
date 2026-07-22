import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';

const ACCOUNT_ID = '648183724555';
// Baked into the edge bundle at synth (not read at runtime from anywhere)
const SUPABASE_URL = 'https://grztmjpzamcxlzecmqca.supabase.co';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Log group for the Lambda@Edge function. The named group below is the
    // CFN-managed one, but Lambda@Edge REPLICAS auto-create a group with this
    // same NAME in whichever region executed the request (us-east-2 for an ORD
    // hit, etc.) — to read edge logs, search for this name in the region
    // nearest the POP, not (only) here. Auto-created twins default to
    // never-expire retention; the setting below governs only this group.
    const ogLogGroup = new logs.LogGroup(this, 'OgMetaFunctionLogGroup', {
      logGroupName: '/salishsea/edge-og-meta',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Bake Supabase config into the edge bundle at synth time. Lambda@Edge
    // forbids environment variables, and neither value is secret — the anon key
    // ships in every browser bundle. Overwrites the tsc-compiled config.js
    // placeholder; a synth without --context supabaseAnonKey (unit tests) bakes
    // an empty key, which the handler treats as fail-open.
    const supabaseAnonKey = this.node.tryGetContext('supabaseAnonKey') ?? '';
    fs.writeFileSync(
      path.join(__dirname, 'edge-handler', 'config.js'),
      '// Generated at synth by infra-stack.ts — do not edit.\n' +
      `module.exports = { SUPABASE_URL: ${JSON.stringify(SUPABASE_URL)}, ` +
      `SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey)} };\n`,
    );

    // Lambda@Edge function — automatically provisioned in us-east-1 regardless of stack region
    const ogFunction = new cloudfront.experimental.EdgeFunction(this, 'OgMetaFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      // Ship only the runtime .js — a test-file edit must not republish the
      // edge function (each publish is a CloudFront distribution update).
      code: lambda.Code.fromAsset(path.join(__dirname, 'edge-handler'), {
        exclude: ['*.ts', '*.test.*'],
      }),
      // DO NOT set environment — Lambda@Edge does not support environment variables
      // 5s is the maximum for viewer-request; the handler's own fetch deadline
      // (FETCH_TIMEOUT_MS) must stay comfortably below it (salishsea-io-g9e)
      timeout: cdk.Duration.seconds(5),
      logGroup: ogLogGroup,
    });

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

    // --- Site-monitoring analytics over the CloudFront access logs (Glue + Athena) ---
    // Ad-hoc analysis layer: a Glue catalog table over the access logs in `logBucket`, plus
    // saved Athena queries. Query source of truth is infra/athena/*.sql; usage in infra/athena/README.md.

    const athenaResultsBucket = new s3.Bucket(this, 'AthenaResults', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const LOGS_DB = 'salishsea_logs';

    const logsDatabase = new glue.CfnDatabase(this, 'LogsDatabase', {
      catalogId: ACCOUNT_ID,
      databaseInput: {
        name: LOGS_DB,
        description: 'CloudFront access-log analytics for salishsea.io',
      },
    });

    // External table over the CloudFront standard (legacy) access logs. Field order is fixed
    // by the CloudFront log format — see the #Fields header line in any log file.
    const cloudfrontLogColumns: glue.CfnTable.ColumnProperty[] = [
      { name: 'date', type: 'date' }, { name: 'time', type: 'string' },
      { name: 'location', type: 'string' }, { name: 'sc_bytes', type: 'bigint' },
      { name: 'request_ip', type: 'string' }, { name: 'method', type: 'string' },
      { name: 'host', type: 'string' }, { name: 'uri', type: 'string' },
      { name: 'status', type: 'int' }, { name: 'referrer', type: 'string' },
      { name: 'user_agent', type: 'string' }, { name: 'query_string', type: 'string' },
      { name: 'cookie', type: 'string' }, { name: 'result_type', type: 'string' },
      { name: 'request_id', type: 'string' }, { name: 'host_header', type: 'string' },
      { name: 'request_protocol', type: 'string' }, { name: 'cs_bytes', type: 'bigint' },
      { name: 'time_taken', type: 'float' }, { name: 'xforwarded_for', type: 'string' },
      { name: 'ssl_protocol', type: 'string' }, { name: 'ssl_cipher', type: 'string' },
      { name: 'response_result_type', type: 'string' }, { name: 'http_version', type: 'string' },
      { name: 'fle_status', type: 'string' }, { name: 'fle_encrypted_fields', type: 'int' },
      { name: 'c_port', type: 'int' }, { name: 'time_to_first_byte', type: 'float' },
      { name: 'x_edge_detailed_result_type', type: 'string' }, { name: 'sc_content_type', type: 'string' },
      { name: 'sc_content_len', type: 'bigint' }, { name: 'sc_range_start', type: 'bigint' },
      { name: 'sc_range_end', type: 'bigint' },
    ];

    const cloudfrontLogsTable = new glue.CfnTable(this, 'CloudFrontLogsTable', {
      catalogId: ACCOUNT_ID,
      databaseName: LOGS_DB,
      tableInput: {
        name: 'cloudfront_logs',
        description: 'CloudFront standard (legacy) access logs for salishsea.io',
        tableType: 'EXTERNAL_TABLE',
        parameters: { EXTERNAL: 'TRUE', 'skip.header.line.count': '2' },
        storageDescriptor: {
          columns: cloudfrontLogColumns,
          location: `s3://${logBucket.bucketName}/cloudfront/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
            parameters: { 'field.delim': '\t' },
          },
        },
      },
    });
    cloudfrontLogsTable.addDependency(logsDatabase);

    // Dedicated workgroup so monitoring queries write results to the bucket above by default.
    const workgroup = new athena.CfnWorkGroup(this, 'MonitoringWorkGroup', {
      name: 'salishsea-monitoring',
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: false,
        resultConfiguration: {
          outputLocation: `s3://${athenaResultsBucket.bucketName}/`,
        },
      },
    });

    // Save every infra/athena/*.sql file as a named query (source of truth = the .sql files).
    // human_pageviews_view.sql is one of these — run it once after deploy to (re)create the view.
    const athenaDir = path.join(__dirname, '..', 'athena');
    for (const file of fs.readdirSync(athenaDir).filter((f) => f.endsWith('.sql')).sort()) {
      const slug = file.replace(/\.sql$/, '');
      const namedQuery = new athena.CfnNamedQuery(this, 'NamedQuery' + slug.replace(/[^a-zA-Z0-9]/g, ''), {
        name: slug,
        database: LOGS_DB,
        queryString: fs.readFileSync(path.join(athenaDir, file), 'utf8'),
        workGroup: workgroup.name,
      });
      namedQuery.addDependency(workgroup);
    }
  }
}
