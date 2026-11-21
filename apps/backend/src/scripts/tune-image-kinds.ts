#!/usr/bin/env node
/**
 * Read-only tuning run for the image-kind classifier. Scores one or more prompt-set files against the stored image
 * embeddings and prints, for each, the verdict-by-category table, the two privacy lists, the disagreements, the flip bar
 * and a margin grid. It writes no verdict: the library is read in one READ ONLY transaction and the rest is in memory.
 * It reads each image's EXIF from the stored file (in memory) and asks reverie-ml to embed the prompt texts.
 * Output holds ids, filenames, categories and scores only: no image or OCR content.
 *
 * Usage (cwd = apps/backend/dist in a container that reaches Postgres, reverie-ml and the storage volume):
 *   node apps/backend/src/scripts/tune-image-kinds.js --prompts <set.json> [--prompts <more.json> ...]
 * Prompt-set files are in apps/backend/scripts/image-kind-sets/.
 */
import { readFile } from 'node:fs/promises';
import { parsePromptArgs, parsePromptSet, type PromptSet } from '../image-kind/prompt-set.js';
import { runTuning } from '../image-kind/tune-runner.js';

async function loadSets(paths: string[]): Promise<PromptSet[]> {
    return Promise.all(
        paths.map(async (path) => {
            try {
                return parsePromptSet(JSON.parse(await readFile(path, 'utf8')));
            } catch (error) {
                throw new Error('Cannot use prompt set ' + path + ': ' + (error instanceof Error ? error.message : String(error)));
            }
        }),
    );
}

async function main(): Promise<void> {
    const paths = parsePromptArgs(process.argv.slice(2));

    if (paths.length === 0) throw new Error('Usage: tune-image-kinds.js --prompts <set.json> [--prompts <more.json> ...]');

    const sets = await loadSets(paths);

    // Import lazily so env.ts (which validates and can exit) loads only when the script runs.
    const { db } = await import('../db/kysely.js');
    const { getMlClient } = await import('../embeddings/ml.client.js');
    const { getStorageService } = await import('../services/storage.service.js');
    const ml = getMlClient();

    try {
        if (!ml) throw new Error('reverie-ml is not configured: set ML_URL');

        await runTuning({ db, ml, readFile: (path) => getStorageService().readFile(path) }, sets, (text) => process.stdout.write(text));
    } finally {
        await db.destroy();
    }
}

main().catch((error: unknown) => {
    console.error('Tuning failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
