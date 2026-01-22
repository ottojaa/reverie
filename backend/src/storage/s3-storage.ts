import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createHash } from 'crypto'
import type { IStorageProvider, StorageMetadata, StorageResult } from './storage.interface'

export interface S3StorageConfig {
  bucket: string
  endpoint?: string | undefined
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export class S3StorageProvider implements IStorageProvider {
  private client: S3Client
  private bucket: string

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: !!config.endpoint, // Required for MinIO
    })
  }

  async store(file: Buffer, storagePath: string, metadata?: StorageMetadata): Promise<StorageResult> {
    const hash = createHash('sha256').update(file).digest('hex')

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
        Body: file,
        ContentType: metadata?.contentType,
        Metadata: {
          ...metadata?.custom,
          'x-file-hash': hash,
        },
      })
    )

    return {
      path: storagePath,
      size: file.length,
      hash,
    }
  }

  async retrieve(storagePath: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
      })
    )

    const stream = response.Body as NodeJS.ReadableStream
    const chunks: Buffer[] = []

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  async delete(storagePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
      })
    )
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: storagePath,
        })
      )
      return true
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'NotFound') {
        return false
      }
      throw error
    }
  }

  async getMetadata(storagePath: string): Promise<StorageMetadata> {
    const response = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
      })
    )

    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      hash: response.Metadata?.['x-file-hash'],
      custom: response.Metadata,
    }
  }

  async generateUrl(storagePath: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storagePath,
    })

    return getSignedUrl(this.client, command, { expiresIn })
  }
}

