import { StorageError } from '@reverie/shared';
import { encode } from 'blurhash';
import { createHash } from 'crypto';
import { join } from 'path';
import sharp from 'sharp';
import { db } from '../db/kysely';
import type { ThumbnailPaths } from '../db/schema';
import { generateStoragePath, getExtension, getStorage } from '../storage';

export interface ProcessedImage {
    buffer: Buffer;
    hash: string;
    storagePath: string;
    width: number;
    height: number;
    blurhash: string;
}

export interface ThumbnailResult {
    paths: ThumbnailPaths;
    blurhash: string;
}

export interface UserStorageContext {
    userId: string;
    storagePath: string; // e.g., "users/abc123"
    storageQuotaBytes: number;
    storageUsedBytes: number;
}

const THUMBNAIL_SIZES = {
    sm: 150,
    md: 300,
    lg: 600,
} as const;

export class StorageService {
    private storage = getStorage();

    /**
     * Get user storage context from database
     */
    async getUserStorageContext(userId: string): Promise<UserStorageContext> {
        const user = await db
            .selectFrom('users')
            .select(['id', 'storage_path', 'storage_quota_bytes', 'storage_used_bytes'])
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!user) {
            throw new StorageError(`User not found: ${userId}`);
        }

        return {
            userId: user.id,
            storagePath: user.storage_path,
            storageQuotaBytes: Number(user.storage_quota_bytes),
            storageUsedBytes: Number(user.storage_used_bytes),
        };
    }

    /**
     * Check if user has enough storage quota for a file
     */
    checkStorageQuota(context: UserStorageContext, fileSize: number): void {
        const newUsed = context.storageUsedBytes + fileSize;
        if (newUsed > context.storageQuotaBytes) {
            const availableBytes = context.storageQuotaBytes - context.storageUsedBytes;
            throw new StorageError(`Storage quota exceeded. Available: ${this.formatBytes(availableBytes)}, ` + `Required: ${this.formatBytes(fileSize)}`);
        }
    }

    /**
     * Update user's storage usage
     */
    async updateStorageUsage(userId: string, deltaBytes: number): Promise<void> {
        await db
            .updateTable('users')
            .set((eb) => ({
                storage_used_bytes: eb('storage_used_bytes', '+', deltaBytes),
            }))
            .where('id', '=', userId)
            .execute();
    }

    /**
     * Format bytes to human-readable string
     */
    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    /**
     * Generate user-scoped storage path
     */
    getUserScopedPath(userStoragePath: string, filePath: string): string {
        return join(userStoragePath, filePath);
    }

    /**
     * Process and store an uploaded image (with user context)
     */
    async processAndStoreImage(buffer: Buffer, originalFilename: string, mimeType: string, userContext?: UserStorageContext): Promise<ProcessedImage> {
        // Check quota if user context is provided
        if (userContext) {
            this.checkStorageQuota(userContext, buffer.length);
        }

        // Get image metadata
        const metadata = await sharp(buffer).metadata();
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;

        // Calculate hash
        const hash = createHash('sha256').update(buffer).digest('hex');

        // Generate storage path (relative to user's storage directory)
        const extension = getExtension(originalFilename) || mimeType.split('/')[1] || 'jpg';
        const relativeStoragePath = generateStoragePath(hash, extension);

        // Add user prefix if context provided
        const storagePath = userContext ? this.getUserScopedPath(userContext.storagePath, relativeStoragePath) : relativeStoragePath;

        // Generate blurhash from small version
        const blurhash = await this.generateBlurhash(buffer);

        // Store original file
        await this.storage.store(buffer, storagePath, {
            contentType: mimeType,
        });

        // Update storage usage if user context provided
        if (userContext) {
            await this.updateStorageUsage(userContext.userId, buffer.length);
        }

        return {
            buffer,
            hash,
            storagePath,
            width,
            height,
            blurhash,
        };
    }

    /**
     * Generate thumbnails for an image (with user context)
     */
    async generateThumbnails(buffer: Buffer, hash: string, userContext?: UserStorageContext): Promise<ThumbnailResult> {
        const paths: Partial<ThumbnailPaths> = {};
        let totalThumbnailSize = 0;

        // First pass: generate thumbnails and calculate total size
        const thumbnailBuffers: Array<{ size: string; buffer: Buffer; path: string }> = [];

        for (const [size, dimension] of Object.entries(THUMBNAIL_SIZES)) {
            const thumbnailBuffer = await sharp(buffer)
                .resize(dimension, dimension, {
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .jpeg({ quality: 80 })
                .toBuffer();

            const relativePath = generateStoragePath(`${hash}_${size}`, 'jpg');
            const thumbnailPath = userContext ? this.getUserScopedPath(userContext.storagePath, relativePath) : relativePath;

            thumbnailBuffers.push({ size, buffer: thumbnailBuffer, path: thumbnailPath });
            totalThumbnailSize += thumbnailBuffer.length;
        }

        // Check quota for all thumbnails
        if (userContext) {
            this.checkStorageQuota(userContext, totalThumbnailSize);
        }

        // Second pass: store thumbnails
        for (const { size, buffer: thumbBuffer, path } of thumbnailBuffers) {
            await this.storage.store(thumbBuffer, path, {
                contentType: 'image/jpeg',
            });
            paths[size as keyof ThumbnailPaths] = path;
        }

        // Update storage usage
        if (userContext) {
            await this.updateStorageUsage(userContext.userId, totalThumbnailSize);
        }

        // Generate blurhash
        const blurhash = await this.generateBlurhash(buffer);

        return {
            paths: paths as ThumbnailPaths,
            blurhash,
        };
    }

    /**
     * Generate a blurhash for an image
     */
    private async generateBlurhash(buffer: Buffer): Promise<string> {
        const { data, info } = await sharp(buffer).raw().ensureAlpha().resize(32, 32, { fit: 'inside' }).toBuffer({ resolveWithObject: true });

        return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
    }

    /**
     * Get a file from storage
     */
    async getFile(path: string): Promise<Buffer> {
        return this.storage.retrieve(path);
    }

    /**
     * Check if a file exists by hash
     */
    async fileExistsByHash(hash: string, extension: string): Promise<boolean> {
        const path = generateStoragePath(hash, extension);
        return this.storage.exists(path);
    }

    /**
     * Generate a URL for a file
     */
    async getFileUrl(path: string, expiresIn?: number): Promise<string> {
        return this.storage.generateUrl(path, expiresIn);
    }

    /**
     * Delete a file (with optional storage usage update)
     */
    async deleteFile(path: string, userId?: string): Promise<void> {
        // Get file size before deleting (for storage usage update)
        if (userId) {
            try {
                const metadata = await this.storage.getMetadata(path);
                await this.storage.delete(path);
                // Reduce storage usage (negative delta)
                if (metadata.contentLength) {
                    await this.updateStorageUsage(userId, -metadata.contentLength);
                }
            } catch {
                // File might not exist, just try to delete
                await this.storage.delete(path);
            }
        } else {
            await this.storage.delete(path);
        }
    }

    /**
     * Read a file from storage
     * Alias for getFile for clearer naming
     */
    async readFile(path: string): Promise<Buffer> {
        return this.storage.retrieve(path);
    }

    /**
     * Write a file to storage
     */
    async writeFile(path: string, buffer: Buffer, contentType?: string): Promise<void> {
        await this.storage.store(buffer, path, {
            contentType,
        });
    }
}

// Singleton instance
let storageServiceInstance: StorageService | null = null;

export function getStorageService(): StorageService {
    if (!storageServiceInstance) {
        storageServiceInstance = new StorageService();
    }
    return storageServiceInstance;
}
