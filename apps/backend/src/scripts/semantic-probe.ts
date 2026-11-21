#!/usr/bin/env node
/**
 * Read-only: shows what meaning search keeps and drops for some queries, to tune the cutoffs.
 *
 * For each query and each meaning stream (text, image) it prints the library's noise level for that query
 * (median similarity and spread over a fixed sample of the embeddings, at most 5000), the cutoff the rule derives from it, and the top
 * hits with their similarity, how many sigmas above the median they sit, and whether they were kept.
 * Only file names are printed, never document content. It embeds the queries through reverie-ml (ML_URL) and
 * reads the database; nothing is written or queued.
 *
 * Usage (in the prod container, cwd = apps/backend/dist):
 *   docker exec reverie-backend sh -c 'cd apps/backend/dist && node apps/backend/src/scripts/semantic-probe.js "sunset at the beach" "bank statement" "lumi talvi"'
 *   # local dev: npx tsx apps/backend/src/scripts/semantic-probe.ts "bank statement" --top 20
 *
 * Flags:
 *   --user <id>   Whose library to search. (default: the only user, or the one with most documents)
 *   --top <n>     Hits listed per stream. (default: 10)
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { SemanticProbe, StreamProbe } from '../search/semantic-rank.js';

const NAME_WIDTH = 48;

const toRows = (stream: StreamProbe, names: ReadonlyMap<string, string>, top: number): string[] =>
    stream.hits.slice(0, top).map((hit) => {
        const sigma = stream.noise?.sigma;
        const z = stream.noise && sigma ? ((hit.similarity - stream.noise.median) / sigma).toFixed(1) : '-';
        const verdict = hit.similarity >= stream.cutoff.similarity ? 'kept   ' : 'dropped';

        return `    ${verdict} ${hit.similarity.toFixed(3)}  z=${z.padStart(5)}  ${(names.get(hit.id) ?? hit.id).slice(0, NAME_WIDTH)}`;
    });

function toHeader(label: string, stream: StreamProbe): string {
    const noise = stream.noise
        ? `${stream.noise.total} vectors (${stream.noise.sample} sampled, ${stream.noise.elapsedMs} ms), median ${stream.noise.median.toFixed(3)}, sigma ${stream.noise.sigma.toFixed(3)}`
        : 'no vectors to compare';
    const rule = stream.cutoff.z === null ? 'absolute floor only' : `${stream.cutoff.z.toFixed(2)} sigma above the median`;

    return `  ${label}: ${noise}; cutoff ${stream.cutoff.similarity.toFixed(3)} (${rule})`;
}

async function main(): Promise<void> {
    const argv = await yargs(hideBin(process.argv))
        .command('$0 <queries..>', 'Probe meaning search for queries', (y) =>
            y.positional('queries', { type: 'string', array: true, describe: 'Search texts', demandOption: true }),
        )
        .option('user', { type: 'string', describe: 'User id whose library to search' })
        .option('top', { type: 'number', default: 10, describe: 'Hits listed per stream' })
        .strict()
        .parseAsync();

    // Import after argv parse so env.ts (which validates + can exit) loads lazily.
    const { db } = await import('../db/kysely.js');
    const { parseQuery } = await import('../search/query-parser.js');
    const { getSemanticSearch } = await import('../search/semantic-rank.js');
    const { getPrivateFolderIds } = await import('../services/privacy.js');

    try {
        const userId = argv.user ?? (await findDefaultUser(db));
        const privateFolderIds = await getPrivateFolderIds(userId);

        for (const query of argv.queries as string[]) {
            const found: SemanticProbe | null = await getSemanticSearch().probe(parseQuery(query), { userId, privateFolderIds });

            console.log(`\n"${query}"`);

            if (!found) {
                console.log('  meaning search is off, unreachable, or the query has no searchable text');
                continue;
            }

            for (const [label, stream] of [
                ['text ', found.text],
                ['image', found.image],
            ] as const) {
                const shown = stream.hits.slice(0, argv.top);
                const names = await findNames(
                    db,
                    shown.map((hit) => hit.id),
                );

                console.log(toHeader(label, stream));
                console.log(toRows(stream, names, argv.top).join('\n') || '    (no candidates)');
            }
        }
    } finally {
        await db.destroy();
    }
}

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

async function findNames(db: Db, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();

    const rows = await db.selectFrom('documents').select(['id', 'original_filename']).where('id', 'in', ids).execute();

    return new Map(rows.map((row) => [row.id, row.original_filename]));
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
