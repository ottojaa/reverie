import type { CheckContentResult, ContentLocation } from '@reverie/shared';
import type { UploadFile } from './types';

/** A queued file the check had something to say about. */
export interface ReviewItem {
    fileId: string;
    name: string;
    size: number;
    result: CheckContentResult;
}

/** Pairs the queued files with the check's answers (same order) and keeps the files that need a decision. */
export function toReviewItems(queued: UploadFile[], results: CheckContentResult[]): ReviewItem[] {
    return queued.flatMap((upload, index) => {
        const result = results[index];

        if (!result || (!result.content && !result.name_conflict)) return [];

        return [{ fileId: upload.id, name: upload.file.name, size: upload.file.size, result }];
    });
}

/** "/Work/Invoices" -> "Work › Invoices". Null (a document with no folder) has no path to show. */
export function toBreadcrumb(folderPath: string[]): string {
    return folderPath.join(' › ');
}

/**
 * The wording for where content already is. Android's review sheet says the same thing; keep them in step.
 * `detail` is the existing filename, shown only when it differs from the file being uploaded.
 */
export function describeContent(content: ContentLocation, uploadName: string): { label: string; detail?: string } {
    if (content.where === 'private') return { label: 'Already in a private folder' };

    if (content.where === 'trash') return { label: 'Already in Trash' };

    const detail = content.filename === uploadName ? undefined : `As ${content.filename}`;
    const label = content.folder_path ? `Already in ${toBreadcrumb(content.folder_path)}` : 'Already in your library, not in a folder';

    return { label, detail };
}

export function describeNameConflict(folderName: string | undefined, hasContentMatch: boolean): string {
    const where = folderName ?? 'this folder';

    return hasContentMatch ? `Same name also exists in ${where}` : `A different file with this name is already in ${where}`;
}

/** Whether a file with this result still needs a replace / keep both answer once the person has decided on it. */
export function needsConflictChoice(item: ReviewItem, uploadAnyway: boolean): boolean {
    if (!item.result.name_conflict) return false;

    return !item.result.content || uploadAnyway;
}
