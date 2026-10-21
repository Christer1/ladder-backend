import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EnvironmentVariables } from '../../config/env.validation';

// Private S3-compatible bucket. Callers store only the returned key, never the file, in the DB.
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
    const endpoint = config.get('S3_ENDPOINT', { infer: true });

    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.client = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      ...(endpoint && { endpoint, forcePathStyle: true }),
      ...(accessKeyId && secretAccessKey && { credentials: { accessKeyId, secretAccessKey } }),
    });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return key;
  }
}
