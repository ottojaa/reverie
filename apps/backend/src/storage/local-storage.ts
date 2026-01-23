import { createReadStream, createWriteStream } from 'fs'
import { mkdir, stat, unlink, access } from 'fs/promises'
import { createHash } from 'crypto'
import * as path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { IStorageProvider, StorageMetadata, StorageResult } from './storage.interface'

export class LocalStorageProvider implements IStorageProvider {
  constructor(private readonly rootPath: string) {}

  async store(file: Buffer, storagePath: string, metadata?: StorageMetadata): Promise<StorageResult> {
    const absolutePath = this.getAbsolutePath(storagePath)
    const dir = path.dirname(absolutePath)

    // Ensure directory exists
    await mkdir(dir, { recursive: true })

    // Calculate hash
    const hash = createHash('sha256').update(file).digest('hex')

    // Write file
    const readable = Readable.from(file)
    const writable = createWriteStream(absolutePath)
    await pipeline(readable, writable)

    return {
      path: storagePath,
      size: file.length,
      hash,
    }
  }

  async retrieve(storagePath: string): Promise<Buffer> {
    const absolutePath = this.getAbsolutePath(storagePath)
    const chunks: Buffer[] = []

    const stream = createReadStream(absolutePath)

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  async delete(storagePath: string): Promise<void> {
    const absolutePath = this.getAbsolutePath(storagePath)
    await unlink(absolutePath)
  }

  async exists(storagePath: string): Promise<boolean> {
    const absolutePath = this.getAbsolutePath(storagePath)
    try {
      await access(absolutePath)
      return true
    } catch {
      return false
    }
  }

  async getMetadata(storagePath: string): Promise<StorageMetadata> {
    const absolutePath = this.getAbsolutePath(storagePath)
    const stats = await stat(absolutePath)

    // Calculate hash for existing file
    const fileBuffer = await this.retrieve(storagePath)
    const hash = createHash('sha256').update(fileBuffer).digest('hex')

    return {
      contentLength: stats.size,
      lastModified: stats.mtime,
      hash,
    }
  }

  async generateUrl(storagePath: string, _expiresIn?: number): Promise<string> {
    // For local storage, return a path that can be served via a file-serving endpoint
    return `/files/${storagePath}`
  }

  getAbsolutePath(storagePath: string): string {
    return path.join(this.rootPath, storagePath)
  }
}

