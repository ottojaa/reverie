#!/usr/bin/env node
/**
 * Read-only report: the image-kind verdicts (shadow mode) against each image's current `document_category`.
 * Prints counts, a verdict-by-category table, every disagreement with its scores, and the two lists to check before
 * the flip: camera images with no text, and current photos, that got a non-photo verdict. Ids, filenames, categories
 * and scores only: no image or OCR content. It writes nothing: the whole run is one READ ONLY transaction.
 *
 * Usage (in the prod container, cwd = apps/backend/dist):
 *   docker exec reverie-backend sh -c 'cd apps/backend/dist && node apps/backend/src/scripts/compare-image-kinds.js'
 */
import { runComparison } from '../image-kind/compare-runner.js';

async function main(): Promise<void> {
    // Import lazily so env.ts (which validates and can exit) loads only when the script runs.
    const { db } = await import('../db/kysely.js');

    try {
        await runComparison(db, (text) => process.stdout.write(text));
    } finally {
        await db.destroy();
    }
}

main().catch((error: unknown) => {
    console.error('Comparison failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
