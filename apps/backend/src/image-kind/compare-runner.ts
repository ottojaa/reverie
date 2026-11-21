/** Reads every live image with its shadow verdict and writes the comparison report. Read-only: one READ ONLY transaction. */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { buildReport, type ComparisonRow } from './compare-report.js';
import type { ImageKind } from './kinds.js';

/** Every live image with its verdict (if any) and the camera facts present. */
export async function loadComparisonRows(db: Kysely<Database>): Promise<ComparisonRow[]> {
    return db.transaction().execute(async (trx) => {
        await sql`SET TRANSACTION READ ONLY`.execute(trx);

        const rows = await trx
            .selectFrom('documents as d')
            .leftJoin('document_image_kinds as k', 'k.document_id', 'd.id')
            .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
            .select([
                'd.id',
                'd.original_filename',
                'd.document_category',
                'd.has_meaningful_text',
                'k.kind',
                'k.scores',
                'k.prompt_version',
                'pm.taken_at',
                'pm.latitude',
                'pm.longitude',
                'pm.camera_make',
                'pm.camera_model',
                'pm.lens_model',
            ])
            .where('d.deleted_at', 'is', null)
            .where('d.mime_type', 'like', 'image/%')
            .orderBy('d.created_at')
            .orderBy('d.id')
            .execute();

        return rows.map((row) => ({
            id: row.id,
            filename: row.original_filename,
            category: row.document_category,
            hasMeaningfulText: row.has_meaningful_text,
            kind: row.kind as ImageKind | null,
            scores: row.scores,
            classifierVersion: row.prompt_version,
            capture: {
                takenAt: row.taken_at !== null,
                gps: row.latitude !== null && row.longitude !== null,
                make: Boolean(row.camera_make),
                model: Boolean(row.camera_model),
                lens: Boolean(row.lens_model),
            },
        }));
    });
}

export async function runComparison(db: Kysely<Database>, write: (text: string) => void): Promise<void> {
    write(buildReport(await loadComparisonRows(db)) + '\n');
}
