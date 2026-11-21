import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import type { ModelRef } from '../embeddings/embedding.repository.js';
import type { FrozenSeed, SeedSet, SeedSetStats } from './seed-set.js';
import { toUnit, type SeedKind } from './prototypes.js';

/** Whether a seed set was taken for this classifier version with this image model. */
export async function hasSeedSet(db: Kysely<Database>, version: string, model: ModelRef): Promise<boolean> {
    const row = await db
        .selectFrom('image_kind_seed_sets')
        .select('version')
        .where('version', '=', version)
        .where('model', '=', model.model)
        .where('model_version', '=', model.version)
        .executeTakeFirst();

    return row !== undefined;
}

/**
 * The seed set of a version, with each seed's stored embedding. A seed whose document is deleted, or whose embedding
 * is gone or from another image model, is simply not returned: it drops out of the set. Null when there is no set for
 * this version and image model.
 */
export async function loadSeedSet(db: Kysely<Database>, version: string, model: ModelRef): Promise<SeedSet | null> {
    const set = await db
        .selectFrom('image_kind_seed_sets')
        .select('stats')
        .where('version', '=', version)
        .where('model', '=', model.model)
        .where('model_version', '=', model.version)
        .executeTakeFirst();

    if (!set) return null;

    const rows = await db
        .selectFrom('image_kind_seeds as s')
        .innerJoin('documents as d', 'd.id', 's.document_id')
        .innerJoin('document_image_embeddings as e', 'e.document_id', 's.document_id')
        .select(['s.document_id', 's.kind', sql<string>`e.embedding::text`.as('embedding')])
        .where('s.version', '=', version)
        .where('d.deleted_at', 'is', null)
        .where('e.model', '=', model.model)
        .where('e.model_version', '=', model.version)
        .execute();
    const seeds: FrozenSeed[] = rows.map((row) => ({
        id: row.document_id,
        kind: row.kind as SeedKind,
        embedding: toUnit(JSON.parse(row.embedding) as number[]),
    }));

    return { stats: set.stats as unknown as SeedSetStats, seeds };
}

/**
 * Stores a seed set for a version in one transaction. A version that already has one is refused, because its verdicts
 * were made with it. `replace` swaps it and deletes the verdicts of that version, so the backfill classifies those
 * images again with the new set.
 */
export async function storeSeedSet(
    db: Kysely<Database>,
    version: string,
    model: ModelRef,
    set: { stats: SeedSetStats; seeds: readonly { id: string; kind: SeedKind }[] },
    replace: boolean,
): Promise<void> {
    await db.transaction().execute(async (trx) => {
        const existing = await trx.selectFrom('image_kind_seed_sets').select('version').where('version', '=', version).forUpdate().executeTakeFirst();

        if (existing && !replace) throw new Error('A seed set already exists for this classifier version: ' + version);

        await trx.deleteFrom('image_kind_seed_sets').where('version', '=', version).execute();
        await trx.deleteFrom('document_image_kinds').where('prompt_version', '=', version).execute();
        await trx
            .insertInto('image_kind_seed_sets')
            .values({ version, model: model.model, model_version: model.version, stats: JSON.stringify(set.stats) })
            .execute();

        for (let i = 0; i < set.seeds.length; i += 500) {
            await trx
                .insertInto('image_kind_seeds')
                .values(set.seeds.slice(i, i + 500).map((seed) => ({ version, document_id: seed.id, kind: seed.kind })))
                .execute();
        }
    });
}
