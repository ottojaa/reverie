export interface StorageMetadata {
  contentType?: string | undefined
  contentLength?: number | undefined
  lastModified?: Date | undefined
  hash?: string | undefined
  custom?: Record<string, string> | undefined
}

export interface StorageResult {
  path: string
  size: number
  hash: string
}

export interface IStorageProvider {
  /**
   * Store a file
   */
  store(file: Buffer, path: string, metadata?: StorageMetadata): Promise<StorageResult>

  /**
   * Retrieve a file's contents
   */
  retrieve(path: string): Promise<Buffer>

  /**
   * Delete a file
   */
  delete(path: string): Promise<void>

  /**
   * Check if a file exists
   */
  exists(path: string): Promise<boolean>

  /**
   * Get file metadata
   */
  getMetadata(path: string): Promise<StorageMetadata>

  /**
   * Generate a URL for serving the file
   * @param path - Storage path
   * @param expiresIn - Seconds until URL expires (for signed URLs)
   */
  generateUrl(path: string, expiresIn?: number): Promise<string>

  /**
   * Get the underlying file system path (only for local storage)
   */
  getAbsolutePath?(path: string): string
}

/**
 * Generate a content-addressable storage path from a file hash
 * Pattern: {hash[0:2]}/{hash[2:4]}/{hash}.{ext}
 */
export function generateStoragePath(hash: string, extension: string): string {
  const prefix1 = hash.substring(0, 2)
  const prefix2 = hash.substring(2, 4)
  return `${prefix1}/${prefix2}/${hash}.${extension}`
}

/**
 * Extract extension from filename
 */
export function getExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : ''
}

