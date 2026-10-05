/**
 * One S3 call, PutObject, signed with AWS Signature Version 4 by hand (decision 065,
 * salish-9uu.3.4): the photo upload is the API's only use of AWS, and the SDK would add
 * tens of megabytes to a resident process on a 1 GB machine for one request.
 *
 * The payload is hashed and signed, not sent UNSIGNED-PAYLOAD, so S3 refuses a body
 * that changed on the way. No ACL is sent — the bucket blocks public ACLs and would 403
 * one — and nothing is read back: the API's key may only put objects, under media/.
 */

import { createHash, createHmac } from 'node:crypto';

export type Credentials = {accessKeyId: string, secretAccessKey: string};
export type Bucket = {name: string, region: string, credentials: Credentials};

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** A path as SigV4 encodes it for S3: each segment once, every byte but A-Z a-z 0-9 - . _ ~ escaped. */
export function encodePath(path: string): string {
    return path.split('/').map(segment => encodeURIComponent(segment)
        .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

/** `YYYYMMDDTHHMMSSZ`. */
export const amzDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * The Authorization header for a request with no query string. `headers` are the ones to
 * sign, host and x-amz-date and x-amz-content-sha256 among them, keyed in lower case.
 */
export function authorization(method: string, path: string, headers: Record<string, string>, payloadHash: string,
    region: string, credentials: Credentials): string {
    const date = headers['x-amz-date'];
    if (!date) throw new Error('sign x-amz-date');
    const names = Object.keys(headers).sort();
    const canonical = [
        method,
        encodePath(path),
        '',
        ...names.map(name => `${name}:${headers[name]!.trim().replace(/\s+/g, ' ')}`),
        '',
        names.join(';'),
        payloadHash,
    ].join('\n');
    const scope = `${date.slice(0, 8)}/${region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n');
    let key = hmac(`AWS4${credentials.secretAccessKey}`, date.slice(0, 8));
    for (const part of [region, 's3', 'aws4_request']) key = hmac(key, part);
    const signature = createHmac('sha256', key).update(toSign).digest('hex');
    return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

/** Put `body` at `key`. Throws, naming S3's status and error code, if S3 refuses it. */
export async function putObject(bucket: Bucket, key: string, body: Uint8Array<ArrayBuffer>,
    meta: {contentType: string, cacheControl: string}, now = new Date()): Promise<void> {
    const host = `${bucket.name}.s3.${bucket.region}.amazonaws.com`;
    const path = `/${key}`;
    const payloadHash = sha256(body);
    const headers: Record<string, string> = {
        'cache-control': meta.cacheControl,
        'content-type': meta.contentType,
        host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate(now),
    };
    const auth = authorization('PUT', path, headers, payloadHash, bucket.region, bucket.credentials);
    const {host: _, ...sent} = headers;
    const response = await fetch(`https://${host}${encodePath(path)}`, {
        method: 'PUT',
        headers: {...sent, authorization: auth},
        body,
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        const code = /<Code>([^<]*)<\/Code>/.exec(await response.text())?.[1] ?? 'no error code';
        throw new Error(`S3 refused the photo: ${response.status} ${code}`);
    }
}
