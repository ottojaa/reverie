#!/usr/bin/env node
/**
 * One-off: sets `document_category` of every existing live image from its stored kind verdict, the way the embed worker
 * does for each new image since the flip. Idempotent; prints counts per from -> to category.
 *
 *   --dry-run   print the counts, change nothing
 *   --undo      put the category the OCR heuristics gave back (revert the flip's code change first, so new images stop
 *               taking the verdict path), over a missing or heuristic category only
 *
 * Usage (in the prod container, cwd = apps/backend/dist):
 *   docker exec reverie-backend sh -c 'cd apps/backend/dist && node apps/backend/src/scripts/apply-image-kinds.js --dry-run'
 */
import { runApply } from '../image-kind/apply-runner.js';

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    // Import lazily so env.ts (which validates and can exit) loads only when the script runs.
    const { db } = await import('../db/kysely.js');

    try {
        await runApply(db, { mode: args.includes('--undo') ? 'undo' : 'apply', dryRun: args.includes('--dry-run') }, (text) => process.stdout.write(text));
    } finally {
        await db.destroy();
    }
}

main().catch((error: unknown) => {
    console.error('Apply failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
