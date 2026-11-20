import { documentsApi } from '@/lib/api/documents';
import type { FileHashState } from '@/lib/hash/useFileHashes';
import { toReviewItems, type ReviewItem } from '@/lib/upload/duplicateReview';
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
    folderId: string | undefined;
    startUpload: (folderId: string, strategy?: ConflictStrategy) => Promise<void>;
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
        if (!folderId) return;

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

            if (items.length === 0) return await startUpload(folderId).catch(reportUploadError);

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

        const everythingSkipped = skipIds.length === queued.length;

        if (!folderId || everythingSkipped) return;

        startUpload(folderId, strategy).catch(reportUploadError);
    }

    return { review, isChecking, isHashing, check, confirm, cancel: () => setReview(null) };
}
