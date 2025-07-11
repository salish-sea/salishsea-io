import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const region = 'us-west-2';
export const bucket = process.env.S3_BUCKET;
const s3client = new S3Client({region});

export const getPresignedUserObjectURL = async (sid: string, fileName: string, contentType: string, length: number) => {
  const object = `uploads/${sid}/${fileName}`;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: object,
    ContentType: contentType,
    ContentLength: length,
  });
  return await getSignedUrl(s3client, command, {expiresIn: 3600});
}
