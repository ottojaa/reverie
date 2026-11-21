#!/usr/bin/env node
/**
 * One-off, on the server: takes the frozen seed set of the committed image-kind classifier version from the live
 * library and stores it in `image_kind_seed_sets` / `image_kind_seeds` (the only writes). Until it has run, the
 * classifier classifies nothing for this version; once it has, the embed backfill classifies every image on its own.
 * A version that already has a set is refused unless `--replace` is given; replacing deletes that version's verdicts so
 * the backfill classifies those images again with the new set. Prints counts only.
 *
 * Usage (cwd = apps/backend/dist in a container that reaches Postgres, reverie-ml and the storage volume):
 *   node apps/backend/src/scripts/snapshot-image-kind-seeds.js [--replace]
 */
import { snapshotSeedSet } from '../image-kind/seed-snapshot.js';

async function main(): Promise<void> {
    // Import lazily so env.ts (which validates and can exit) loads only when the script runs.
    const { db } = await import('../db/kysely.js');
    const { getMlClient } = await import('../embeddings/ml.client.js');
    const { getStorageService } = await import('../services/storage.service.js');
    const ml = getMlClient();

    if (!ml) throw new Error('ML_URL is not set: reverie-ml is needed to embed the prompts');

    try {
        const lines = await snapshotSeedSet(
            { db, ml, readFile: (path) => getStorageService().readFile(path) },
            { replace: process.argv.includes('--replace') },
        );

        process.stdout.write(lines.join('\n') + '\n');
    } finally {
        await db.destroy();
    }
}

main().catch((error: unknown) => {
    process.stderr.write(String(error instanceof Error ? error.message : error) + '\n');
    process.exit(1);
});
