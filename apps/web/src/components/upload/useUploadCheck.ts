import { documentsApi } from '@/lib/api/documents';
import type { FileHashState } from '@/lib/hash/useFileHashes';
import { toKeptIds, toReviewItems, type ReviewItem } from '@/lib/upload/duplicateReview';
import { isRetryable, type UploadFile } from '@/lib/upload';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ConflictStrategy } from './DuplicateOptionsDialog';

interface Review {
    /** The files that were checked: confirming sends these, minus the skipped ones. */
    batch: UploadFile[];
    items: ReviewItem[];
    cleanCount: number;
}

interface UseUploadCheckOptions {
    files: UploadFile[];
    hashes: Record<string, FileHashState>;
    /** Null is the top level. */
    folderId: string | null;
    startUpload: (folderId: string | undefined, strategy?: ConflictStrategy, onlyFileIds?: ReadonlySet<string>) => Promise<void>;
    removeFile: (fileId: string) => void;
}

const isPending = (state: FileHashState | undefined): boolean => !state || state.status === 'hashing';

function reportUploadError(error: unknown): void {
    toast.error(error instanceof Error ? error.message : 'Upload failed');
}

/** The "check, then upload or ask" step behind the modal's Upload and Retry all buttons. */
export function useUploadCheck({ files, hashes, folderId, startUpload, removeFile }: UseUploadCheckOptions) {
    const [isChecking, setIsChecking] = useState(false);
    const [review, setReview] = useState<Review | null>(null);

    const queued = files.filter((f) => f.status === 'queued');
    const isHashing = queued.some((f) => isPending(hashes[f.id]));

    async function checkThenUpload(batch: UploadFile[]): Promise<void> {
        setIsChecking(true);

        try {
            const results = await documentsApi.checkContent(
                folderId,
                batch.map((f) => {
                    const state = hashes[f.id];

                    return state?.status === 'done' ? { name: f.file.name, sha256: state.sha256 } : { name: f.file.name };
                }),
            );
            const items = toReviewItems(batch, results);

            if (items.length === 0) {
                const ids = new Set(batch.map((f) => f.id));

                return await startUpload(folderId ?? undefined, undefined, ids).catch(reportUploadError);
            }

            setReview({ batch, items, cleanCount: batch.length - items.length });
        } catch {
            toast.error('Failed to check for duplicates');
        } finally {
            setIsChecking(false);
        }
    }

    function confirm(skipIds: string[], strategy: ConflictStrategy | undefined): void {
        if (!review) return;

        setReview(null);

        for (const id of skipIds) removeFile(id);

        // startUpload reads the files from the render it was created in, where the skipped ones are
        // still listed: name the files to send instead of relying on the removal above.
        const kept = toKeptIds(review.batch, skipIds);

        if (kept.size === 0) return;

        startUpload(folderId ?? undefined, strategy, kept).catch(reportUploadError);
    }

    return {
        review,
        isChecking,
        isHashing,
        check: () => checkThenUpload(queued),
        retry: () => checkThenUpload(files.filter(isRetryable)),
        confirm,
        cancel: () => setReview(null),
    };
}
