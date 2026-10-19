import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StorageConfig, StoredFileMeta } from '../types/index.js';
import type { IStorageDriver } from './storage.interface.js';

export class S3StorageDriver implements IStorageDriver {
  private client: S3Client;
  private bucket: string;

  constructor(config: NonNullable<StorageConfig['s3']>) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
      maxAttempts: 3, // Built-in retry with exponential backoff
    });
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<StoredFileMeta> {
    const etag = crypto.createHash('md5').update(buffer).digest('hex');

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    return {
      key,
      size: buffer.length,
      mimeType,
      etag,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }

  async get(key: string): Promise<{ buffer: Buffer; meta: StoredFileMeta } | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      if (!response.Body) return null;

      // Stream to buffer
      const stream = response.Body as unknown as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const etag = response.ETag?.replace(/["']/g, '') || crypto.createHash('md5').update(buffer).digest('hex');

      return {
        buffer,
        meta: {
          key,
          size: buffer.length,
          mimeType: response.ContentType || 'application/octet-stream',
          etag,
          createdAt: response.LastModified ? Math.floor(response.LastModified.getTime() / 1000) : Math.floor(Date.now() / 1000),
        },
      };
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async getStats(): Promise<{ totalBytes: number; fileCount: number }> {
    // S3 stats are queried on demand or cached
    return { totalBytes: 0, fileCount: 0 };
  }
}
