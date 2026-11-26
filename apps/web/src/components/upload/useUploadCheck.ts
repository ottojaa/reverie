import { documentsApi } from '@/lib/api/documents';
import type { FileHashState } from '@/lib/hash/useFileHashes';
import { toKeptIds, toReviewItems, type ReviewItem } from '@/lib/upload/duplicateReview';
import type { UploadFile } from '@/lib/upload';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ConflictStrategy } from './DuplicateOptionsDialog';

interface Review {
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

/** The "check, then upload or ask" step behind the modal's Upload button. */
export function useUploadCheck({ files, hashes, folderId, startUpload, removeFile }: UseUploadCheckOptions) {
    const [isChecking, setIsChecking] = useState(false);
    const [review, setReview] = useState<Review | null>(null);

    const queued = files.filter((f) => f.status === 'queued');
    const isHashing = queued.some((f) => isPending(hashes[f.id]));

    async function check(): Promise<void> {
        setIsChecking(true);

        try {
            const results = await documentsApi.checkContent(
                folderId,
                queued.map((f) => {
                    const state = hashes[f.id];

                    return state?.status === 'done' ? { name: f.file.name, sha256: state.sha256 } : { name: f.file.name };
                }),
            );
            const items = toReviewItems(queued, results);

            if (items.length === 0) return await startUpload(folderId ?? undefined).catch(reportUploadError);

            setReview({ items, cleanCount: queued.length - items.length });
        } catch {
            toast.error('Failed to check for duplicates');
        } finally {
            setIsChecking(false);
        }
    }

    function confirm(skipIds: string[], strategy: ConflictStrategy | undefined): void {
        setReview(null);

        for (const id of skipIds) removeFile(id);

        // startUpload reads the queue from the render it was created in, where the skipped files are
        // still queued: name the files to send instead of relying on the removal above.
        const kept = toKeptIds(queued, skipIds);

        if (kept.size === 0) return;

        startUpload(folderId ?? undefined, strategy, kept).catch(reportUploadError);
    }

    return { review, isChecking, isHashing, check, confirm, cancel: () => setReview(null) };
}
