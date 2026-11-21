#!/usr/bin/env node
/**
 * Read-only: shows the near-duplicate groups the library would have at several similarity thresholds, to confirm the default
 * (DUPLICATE_MIN_SIMILARITY) on the real library.
 *
 * For every live image outside private folders it asks pgvector for its nearest images (the stored embeddings; ML is not needed and
 * the stored pairs are not used, so a threshold below the configured one is answered too), adds the exact copies (same file hash), then
 * groups them the way the Duplicates view does (complete linkage: every pair in a group reaches the threshold). Per threshold it prints
 * the number of groups, of images in them and of extra copies, and the groups with file names and their lowest similarity.
 * Only file names are printed, never document content, and nothing is written or queued.
 *
 * Usage (in the prod container, cwd = apps/backend/dist):
 *   docker exec reverie-backend sh -c 'cd apps/backend/dist && node apps/backend/src/scripts/duplicate-probe.js'
 *   # local dev: npx tsx apps/backend/src/scripts/duplicate-probe.ts --thresholds 0.97,0.95 --show 20
 *
 * Flags:
 *   --user <id>         Whose library to read. (default: the user with most documents)
 *   --thresholds <a,b>  Similarities to try, any order. (default: 0.99,0.97,0.95,0.92,0.90)
 *   --show <n>          Groups listed per threshold, biggest first. (default: 10)
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { SimilarPair } from '../duplicates/clustering.js';

const NAME_WIDTH = 40;
const NAMES_PER_GROUP = 6;

type Db = typeof import('../db/kysely.js').db;

async function findDefaultUser(db: Db): Promise<string> {
    const row = await db
        .selectFrom('documents')
        .select(['user_id', (eb) => eb.fn.countAll<number>().as('count')])
        .groupBy('user_id')
        .orderBy('count', 'desc')
        .executeTakeFirst();

    if (!row) throw new Error('No documents in the database');

    return row.user_id;
}

function toThresholds(raw: string): number[] {
    const values = raw.split(',').map((part) => Number(part.trim()));

    if (values.some((value) => !Number.isFinite(value) || value <= 0 || value > 1)) throw new Error('Invalid thresholds: ' + raw);

    return values.sort((a, b) => b - a);
}

function toGroupLine(ids: string[], minSimilarity: number, names: ReadonlyMap<string, string>): string {
    const shown = ids.slice(0, NAMES_PER_GROUP).map((id) => (names.get(id) ?? id).slice(0, NAME_WIDTH));
    const more = ids.length > NAMES_PER_GROUP ? `, +${ids.length - NAMES_PER_GROUP} more` : '';

    return `    ${minSimilarity.toFixed(3)}  ${ids.length} images: ${shown.join(' | ')}${more}`;
}

async function main(): Promise<void> {
    const argv = await yargs(hideBin(process.argv))
        .option('user', { type: 'string', describe: 'User id whose library to read' })
        .option('thresholds', { type: 'string', default: '0.99,0.97,0.95,0.92,0.90', describe: 'Comma-separated similarities' })
        .option('show', { type: 'number', default: 10, describe: 'Groups listed per threshold' })
        .strict()
        .parseAsync();
    const thresholds = toThresholds(argv.thresholds);
    const lowest = thresholds[thresholds.length - 1]!;

    // Import after argv parse so env.ts (which validates + can exit) loads lazily.
    const { db } = await import('../db/kysely.js');
    const { clusterCompleteLinkage } = await import('../duplicates/clustering.js');
    const { loadExactPairs } = await import('../duplicates/groups.js');
    const { findNeighbours, loadScanConfig, loadScanSource } = await import('../duplicates/scan.js');
    const { getPrivateFolderIds, excludePrivateDocuments, excludeTrashed } = await import('../services/privacy.js');

    try {
        const userId = argv.user ?? (await findDefaultUser(db));
        const privateFolderIds = await getPrivateFolderIds(userId);
        const base = db
            .selectFrom('documents as d')
            .innerJoin('document_image_embeddings as e', 'e.document_id', 'd.id')
            .select(['d.id', 'd.original_filename'])
            .where('d.user_id', '=', userId);
        const images = await excludePrivateDocuments(excludeTrashed(base, 'd.'), privateFolderIds).execute();
        const names = new Map(images.map((image) => [image.id, image.original_filename]));
        const config = { ...loadScanConfig(), minSimilarity: lowest };
        const pairs = new Map<string, SimilarPair>();

        console.log(`${images.length} images with an embedding outside private folders; looking for neighbours down to ${lowest}`);

        for (const image of images) {
            const source = await loadScanSource(db, image.id);

            if (!source) continue;

            for (const near of await findNeighbours(source, image.id, config)) {
                if (!names.has(near.id)) continue;

                const [a, b] = image.id < near.id ? [image.id, near.id] : [near.id, image.id];

                pairs.set(a + ':' + b, { a, b, similarity: near.similarity });
            }
        }

        const exact = await loadExactPairs({ userId, privateFolderIds, lockFolderIds: null });

        console.log(`${pairs.size} similar pairs, ${exact.length} exact-copy pairs`);

        for (const threshold of thresholds) {
            const kept = [...pairs.values()].filter((pair) => pair.similarity >= threshold);
            const groups = clusterCompleteLinkage([...kept, ...exact]);
            const members = groups.reduce((sum, group) => sum + group.ids.length, 0);

            console.log(`\nthreshold ${threshold}: ${groups.length} groups, ${members} images in them, ${members - groups.length} extra copies`);

            for (const group of groups.slice(0, argv.show)) console.log(toGroupLine(group.ids, group.minSimilarity, names));
        }
    } finally {
        await db.destroy();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
