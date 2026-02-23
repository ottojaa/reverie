import type { ThumbnailPaths } from '../db/schema';
import type { StorageService } from '../services/storage.service';

export type ThumbnailUrls = { sm: string; md: string; lg: string } | null;

export async function resolveThumbnailUrls(
    storageService: StorageService,
    thumbnailPaths: ThumbnailPaths | null,
): Promise<ThumbnailUrls> {
    if (!thumbnailPaths) return null;

    const [sm, md, lg] = await Promise.all([
        storageService.getFileUrl(thumbnailPaths.sm),
        storageService.getFileUrl(thumbnailPaths.md),
        storageService.getFileUrl(thumbnailPaths.lg),
    ]);

    return { sm, md, lg };
}
