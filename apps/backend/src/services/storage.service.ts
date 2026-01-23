import { createHash } from 'crypto'
import sharp from 'sharp'
import { encode } from 'blurhash'
import { getStorage, generateStoragePath, getExtension } from '../storage'
import type { ThumbnailPaths } from '../db/schema'

export interface ProcessedImage {
  buffer: Buffer
  hash: string
  storagePath: string
  width: number
  height: number
  blurhash: string
}

export interface ThumbnailResult {
  paths: ThumbnailPaths
  blurhash: string
}

const THUMBNAIL_SIZES = {
  sm: 150,
  md: 300,
  lg: 600,
} as const

export class StorageService {
  private storage = getStorage()

  /**
   * Process and store an uploaded image
   */
  async processAndStoreImage(
    buffer: Buffer,
    originalFilename: string,
    mimeType: string
  ): Promise<ProcessedImage> {
    // Get image metadata
    const metadata = await sharp(buffer).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0

    // Calculate hash
    const hash = createHash('sha256').update(buffer).digest('hex')

    // Generate storage path
    const extension = getExtension(originalFilename) || mimeType.split('/')[1] || 'jpg'
    const storagePath = generateStoragePath(hash, extension)

    // Generate blurhash from small version
    const blurhash = await this.generateBlurhash(buffer)

    // Store original file
    await this.storage.store(buffer, storagePath, {
      contentType: mimeType,
    })

    return {
      buffer,
      hash,
      storagePath,
      width,
      height,
      blurhash,
    }
  }

  /**
   * Generate thumbnails for an image
   */
  async generateThumbnails(
    buffer: Buffer,
    hash: string
  ): Promise<ThumbnailResult> {
    const paths: Partial<ThumbnailPaths> = {}

    for (const [size, dimension] of Object.entries(THUMBNAIL_SIZES)) {
      const thumbnailBuffer = await sharp(buffer)
        .resize(dimension, dimension, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer()

      const thumbnailPath = generateStoragePath(`${hash}_${size}`, 'jpg')

      await this.storage.store(thumbnailBuffer, thumbnailPath, {
        contentType: 'image/jpeg',
      })

      paths[size as keyof ThumbnailPaths] = thumbnailPath
    }

    // Generate blurhash
    const blurhash = await this.generateBlurhash(buffer)

    return {
      paths: paths as ThumbnailPaths,
      blurhash,
    }
  }

  /**
   * Generate a blurhash for an image
   */
  private async generateBlurhash(buffer: Buffer): Promise<string> {
    const { data, info } = await sharp(buffer)
      .raw()
      .ensureAlpha()
      .resize(32, 32, { fit: 'inside' })
      .toBuffer({ resolveWithObject: true })

    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3)
  }

  /**
   * Get a file from storage
   */
  async getFile(path: string): Promise<Buffer> {
    return this.storage.retrieve(path)
  }

  /**
   * Check if a file exists by hash
   */
  async fileExistsByHash(hash: string, extension: string): Promise<boolean> {
    const path = generateStoragePath(hash, extension)
    return this.storage.exists(path)
  }

  /**
   * Generate a URL for a file
   */
  async getFileUrl(path: string, expiresIn?: number): Promise<string> {
    return this.storage.generateUrl(path, expiresIn)
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    await this.storage.delete(path)
  }

  /**
   * Read a file from storage
   * Alias for getFile for clearer naming
   */
  async readFile(path: string): Promise<Buffer> {
    return this.storage.retrieve(path)
  }

  /**
   * Write a file to storage
   */
  async writeFile(path: string, buffer: Buffer, contentType?: string): Promise<void> {
    await this.storage.store(buffer, path, {
      contentType,
    })
  }
}

// Singleton instance
let storageServiceInstance: StorageService | null = null

export function getStorageService(): StorageService {
  if (!storageServiceInstance) {
    storageServiceInstance = new StorageService()
  }
  return storageServiceInstance
}


