#!/usr/bin/env node
/**
 * Backfill thumbnails for documents uploaded before a file type became thumbnailable.
 *
 * Finds documents that have NO thumbnail (`thumbnail_paths IS NULL`) but whose type is
 * now supported by the thumbnail strategy (office/text/etc.), and re-enqueues a thumbnail
 * job for each — the same path an upload takes. Files that legitimately have no thumbnail
 * (audio, archives, unknown binaries → strategy 'none') are skipped.
 *
 * It enqueues real BullMQ jobs, so the thumbnail WORKER must be running, and its
 * environment must have the render tooling (a monospace font for text; LibreOffice for
 * office docs). Run it against a fully-deployed environment.
 *
 * Only documents with thumbnail_status in ('complete','failed') are considered —
 * 'pending'/'processing' rows are recent uploads already being handled, so we leave them.
 *
 * Usage:
 *   # local dev (tsx available):
 *   npx tsx apps/backend/src/scripts/backfill-thumbnails.ts --dry-run
 *   npx tsx apps/backend/src/scripts/backfill-thumbnails.ts --limit 50
 *
 *   # prod container (compiled; cwd = apps/backend/dist):
 *   docker exec reverie-backend sh -c 'cd apps/backend/dist && node apps/backend/src/scripts/backfill-thumbnails.js --dry-run'
 *
 * Flags:
 *   --dry-run       Report what would be enqueued, change nothing. (default: false)
 *   --limit <n>     Enqueue at most n jobs (still scans all to report totals).
 *   --user <id>     Restrict to a single user's documents.
 *   --batch <n>     DB page size for the keyset scan. (default: 500)
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { getThumbnailStrategy, type ThumbnailStrategy } from '../services/thumbnail-strategy.js';

async function main(): Promise<void> {
    const argv = await yargs(hideBin(process.argv))
        .option('dry-run', { type: 'boolean', default: false, describe: 'Report candidates without enqueuing anything' })
        .option('limit', { type: 'number', describe: 'Enqueue at most this many jobs' })
        .option('user', { type: 'string', describe: 'Restrict to a single user id' })
        .option('batch', { type: 'number', default: 500, describe: 'DB page size for the scan' })
        .strict()
        .parseAsync();

    const dryRun = argv['dry-run'];
    const limit = argv.limit;
    const userId = argv.user;
    const batch = argv.batch;

    // Import after argv parse so env.ts (which validates + can exit) loads lazily.
    const { db } = await import('../db/kysely.js');
    const { addThumbnailJob } = await import('../queues/thumbnail.queue.js');

    const tally: Record<ThumbnailStrategy, number> = { image: 0, pdf: 0, video: 0, office: 0, text: 0, none: 0 };
    let scanned = 0;
    let enqueued = 0;
    let lastId = '';

    console.log(`Backfilling thumbnails${dryRun ? ' (dry run)' : ''}${limit ? `, limit ${limit}` : ''}${userId ? `, user ${userId}` : ''}…`);

    try {
        for (;;) {
            let query = db
                .selectFrom('documents')
                .select(['id', 'user_id', 'file_path', 'mime_type', 'original_filename'])
                .where('thumbnail_paths', 'is', null)
                .where('thumbnail_status', 'in', ['complete', 'failed'])
                .orderBy('id')
                .limit(batch);

            if (userId) query = query.where('user_id', '=', userId);

            // Keyset pagination: processed rows leave the filter (status → pending), but
            // id > lastId only moves forward, so we never revisit or skip a row.
            if (lastId) query = query.where('id', '>', lastId);

            const rows = await query.execute();

            if (rows.length === 0) break;

            for (const row of rows) {
                scanned++;
                const strategy = getThumbnailStrategy(row.mime_type, row.original_filename);
                tally[strategy]++;

                if (strategy === 'none') continue;

                if (dryRun) continue;

                if (limit !== undefined && enqueued >= limit) break;

                const job = await db
                    .insertInto('processing_jobs')
                    .values({ user_id: row.user_id, job_type: 'thumbnail', target_type: 'document', target_id: row.id, status: 'pending', priority: 10 })
                    .returning('id')
                    .executeTakeFirstOrThrow();

                await addThumbnailJob({ documentId: row.id, filePath: row.file_path }, job.id);
                await db.updateTable('documents').set({ thumbnail_status: 'pending' }).where('id', '=', row.id).execute();

                enqueued++;

                if (enqueued % 100 === 0) console.log(`  … enqueued ${enqueued}`);
            }

            if (limit !== undefined && enqueued >= limit) {
                console.log(`Reached limit of ${limit}.`);
                break;
            }

            lastId = rows[rows.length - 1]!.id;
        }

        const eligible = tally.image + tally.pdf + tally.video + tally.office + tally.text;
        console.log(`\nScanned ${scanned} documents without a thumbnail.`);
        console.log(`  Eligible (has a render strategy): ${eligible} — office=${tally.office}, text=${tally.text}, image=${tally.image}, pdf=${tally.pdf}, video=${tally.video}`);
        console.log(`  Skipped (no thumbnail by design): ${tally.none}`);
        console.log(dryRun ? `\nDry run — nothing enqueued. Re-run without --dry-run to enqueue ${limit ? `up to ${limit}` : eligible} job(s).` : `\nEnqueued ${enqueued} thumbnail job(s). Ensure the thumbnail worker is running to process them.`);
    } finally {
        await db.destroy();
        // BullMQ holds a Redis connection open, which keeps the event loop alive.
        process.exit(0);
    }
}

main().catch((error) => {
    console.error('backfill-thumbnails failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
