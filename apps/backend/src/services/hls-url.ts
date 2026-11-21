import { env } from '../config/env';
import { getStorage, LocalStorageProvider } from '../storage';
import { isFileHash, toHlsUrl } from '../storage/hls-token';
import type { JobStatus } from '../db/schema';

/**
 * The signed URL of a video's HLS master playlist, or null when the client should play the original: the video has no
 * complete set of renditions yet, or storage is not local (an S3 presigned URL cannot cover a playlist's relative
 * segment URLs). The caller has already applied the file-URL rules (owner, unlocked folder, not trashed), and the
 * token lives as long as a file URL does.
 */
export function buildHlsMasterUrl(document: { file_hash: string; transcode_status: JobStatus }): string | null {
    if (document.transcode_status !== 'complete') return null;

    if (!isFileHash(document.file_hash)) return null;

    if (!(getStorage() instanceof LocalStorageProvider)) return null;

    return toHlsUrl(document.file_hash, 'master.m3u8', env.FILE_URL_EXPIRES_SECONDS);
}
