/**
 * One-off: rewrites `document_category` of the existing live images, either from their stored kind verdicts (what the
 * embed worker now does for each new image) or back to what the OCR heuristics said (the undo). Idempotent: a second
 * run changes nothing. Only a missing or heuristic category is touched, never one the LLM chose (`invoice`, `letter`); undo also resets the `receipt` that apply wrote.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { classifyNonTextImage, detectScreenshot } from '../ocr/category-classifier.js';
import { KIND_TO_CATEGORY, REPLACEABLE_CATEGORIES, type ImageKind } from './kinds.js';

export type ApplyMode = 'apply' | 'undo';

export interface ApplyRow {
    id: string;
    filename: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    category: string | null;
    hasMeaningfulText: boolean;
    kind: ImageKind | null;
}

export interface CategoryChange {
    id: string;
    from: string | null;
    to: string;
}

/**
 * Whether the script may rewrite this row's category. Apply and undo both touch a missing or heuristic category. Undo
 * also resets a category equal to what the verdict maps to (`receipt`), which is what apply wrote and which is not a
 * heuristic category; a `receipt` the LLM chose for a receipt verdict resets with it, and the LLM re-sets it on reprocess.
 */
function isRewritable(row: ApplyRow, mode: ApplyMode): boolean {
    if (row.category === null || REPLACEABLE_CATEGORIES.includes(row.category)) return true;

    return mode === 'undo' && row.kind !== null && row.category === KIND_TO_CATEGORY[row.kind];
}

/**
 * The category OCR gave this image before verdicts existed. The stored size stands in for the decoded one; an image
 * whose size was never stored has no aspect ratio to judge by, so only its filename and text can decide.
 */
export function toHeuristicCategory(row: ApplyRow): string {
    const imageSize = { width: row.width ?? 0, height: row.height ?? 1 };

    if (detectScreenshot({ filename: row.filename, mimeType: row.mimeType, imageSize })) return 'screenshot';

    if (row.hasMeaningfulText) return 'other';

    return classifyNonTextImage(imageSize, row.filename);
}

function toTargetCategory(row: ApplyRow, mode: ApplyMode): string | null {
    if (mode === 'undo') return toHeuristicCategory(row);

    return row.kind === null ? null : KIND_TO_CATEGORY[row.kind];
}

export function planChanges(rows: ApplyRow[], mode: ApplyMode): CategoryChange[] {
    return rows.flatMap((row) => {
        const to = isRewritable(row, mode) ? toTargetCategory(row, mode) : null;

        return to === null || to === row.category ? [] : [{ id: row.id, from: row.category, to }];
    });
}

async function loadApplyRows(db: Kysely<Database>): Promise<ApplyRow[]> {
    const rows = await db
        .selectFrom('documents as d')
        .leftJoin('document_image_kinds as k', 'k.document_id', 'd.id')
        .select(['d.id', 'd.original_filename', 'd.mime_type', 'd.width', 'd.height', 'd.document_category', 'd.has_meaningful_text', 'k.kind'])
        .where('d.deleted_at', 'is', null)
        .where('d.mime_type', 'like', 'image/%')
        .orderBy('d.created_at')
        .orderBy('d.id')
        .execute();

    return rows.map((row) => ({
        id: row.id,
        filename: row.original_filename,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        category: row.document_category,
        hasMeaningfulText: row.has_meaningful_text,
        kind: row.kind as ImageKind | null,
    }));
}

function summarise(changes: CategoryChange[]): string[] {
    const counts = new Map<string, number>();

    for (const { from, to } of changes) {
        const key = `${from ?? 'none'} -> ${to}`;

        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `  ${key}: ${count}`);
}

/** Applies the plan and prints counts per from -> to category: ids and categories only, no image or OCR content. */
export async function runApply(db: Kysely<Database>, options: { mode: ApplyMode; dryRun: boolean }, write: (text: string) => void): Promise<CategoryChange[]> {
    const rows = await loadApplyRows(db);
    const changes = planChanges(rows, options.mode);

    write(`mode: ${options.mode}${options.dryRun ? ' (dry run, nothing written)' : ''}\n`);
    write(`images: ${rows.length}  to change: ${changes.length}  already right or left alone: ${rows.length - changes.length}\n`);
    summarise(changes).forEach((line) => write(line + '\n'));

    if (options.dryRun) return changes;

    await db.transaction().execute(async (trx) => {
        for (const { id, from, to } of changes) {
            // The category read when planning is re-checked in the WHERE so a row the LLM re-categorised meanwhile is not overwritten.
            await trx
                .updateTable('documents')
                .set({ document_category: to })
                .where('id', '=', id)
                .where((eb) => (from === null ? eb('document_category', 'is', null) : eb('document_category', '=', from)))
                .execute();
        }
    });

    write(`changed: ${changes.length}\n`);

    return changes;
}
