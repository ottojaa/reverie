#!/usr/bin/env node
/**
 * Reprocess a document's OCR and/or LLM analysis (force regeneration).
 *
 * Mirrors the authenticated POST /documents/:id/ocr/retry and
 * /documents/:id/reprocess-llm routes, but runnable directly with no auth for
 * ops/debugging. It enqueues real BullMQ jobs, so the workers must be running
 * (i.e. run it against an environment with a live backend + Redis).
 *
 * Usage (in the prod container, cwd = apps/backend/dist):
 *   docker exec reverie-backend sh -c 'cd apps/backend/dist && yarn run reprocess <documentId>'
 *   docker exec reverie-backend sh -c 'cd apps/backend/dist && node apps/backend/src/scripts/reprocess.js <documentId> --stage llm'
 *
 * --stage ocr  (default): re-run OCR; on success the OCR worker chains into LLM
 *                         automatically (so this is the full-pipeline reprocess).
 * --stage llm            : re-run LLM only, against the existing OCR text.
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

async function main(): Promise<void> {
    const argv = await yargs(hideBin(process.argv))
        .command('$0 <documentId>', 'Reprocess a document', (y) =>
            y.positional('documentId', { type: 'string', describe: 'Document UUID', demandOption: true }),
        )
        .option('stage', {
            choices: ['ocr', 'llm'] as const,
            default: 'ocr' as const,
            describe: 'ocr = OCR then (chained) LLM; llm = LLM only on existing OCR text',
        })
        .strict()
        .parseAsync();

    const documentId = argv.documentId as string;
    const { stage } = argv;

    // Import after argv parse so env.ts (which validates + can exit) loads lazily.
    const { db } = await import('../db/kysely.js');
    const { addOcrJob } = await import('../queues/ocr.queue.js');
    const { addLlmJob } = await import('../queues/llm.queue.js');

    try {
        const doc = await db.selectFrom('documents').select(['user_id', 'file_path']).where('id', '=', documentId).executeTakeFirst();

        if (!doc) {
            throw new Error('Document not found: ' + documentId);
        }

        if (stage === 'ocr') {
            const job = await db
                .insertInto('processing_jobs')
                .values({ user_id: doc.user_id, job_type: 'ocr', target_type: 'document', target_id: documentId, status: 'pending' })
                .returning('id')
                .executeTakeFirstOrThrow();

            await addOcrJob({ documentId, userId: doc.user_id, filePath: doc.file_path, forceReprocess: true }, job.id);
            await db.updateTable('documents').set({ ocr_status: 'pending' }).where('id', '=', documentId).execute();

            console.log('Enqueued OCR reprocess (chains into LLM on success). job_id: ' + job.id);
        } else {
            await db.deleteFrom('llm_results').where('document_id', '=', documentId).execute();
            await db.updateTable('documents').set({ llm_status: 'pending' }).where('id', '=', documentId).execute();

            const job = await db
                .insertInto('processing_jobs')
                .values({ user_id: doc.user_id, job_type: 'llm_summary', target_type: 'document', target_id: documentId, status: 'pending' })
                .returning('id')
                .executeTakeFirstOrThrow();

            await addLlmJob({ documentId, userId: doc.user_id }, job.id);

            console.log('Enqueued LLM reprocess. job_id: ' + job.id);
        }
    } finally {
        await db.destroy();
        // BullMQ holds a Redis connection open, which keeps the event loop alive;
        // exit explicitly once the job is persisted.
        process.exit(0);
    }
}

main().catch((error) => {
    console.error('reprocess failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
