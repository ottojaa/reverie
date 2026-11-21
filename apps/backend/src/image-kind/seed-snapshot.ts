/**
 * Takes the seed set for the committed classifier version from the live library, once, on the server. It reads the
 * library as the tuner does (stored files for EXIF, in memory) and writes the set to `image_kind_seed_sets` and
 * `image_kind_seeds` only. Output is counts, never ids, embeddings or filenames.
 */
import { sql } from 'kysely';
import { scoreKinds } from './classifier.js';
import { KIND_CLASSIFIER, type KindClassifierConfig } from './classifier-config.js';
import { embedPrompts } from './prompt-cache.js';
import { toSeedRules } from './prototype-run.js';
import { MIN_SEEDS, SEED_KINDS } from './prototypes.js';
import { buildSeedSet } from './seed-set.js';
import { storeSeedSet } from './seed-set.repository.js';
import { loadLibrary, type TuneDeps } from './tune-runner.js';

export interface SnapshotOptions {
    config?: KindClassifierConfig;
    /** Swap a set that already exists for the version. Its verdicts were made with it, so they need re-classifying after. */
    replace?: boolean;
}

export async function snapshotSeedSet(deps: TuneDeps, options: SnapshotOptions = {}): Promise<string[]> {
    const config = options.config ?? KIND_CLASSIFIER;

    if (!config.prototypes) throw new Error('This classifier version has no prototypes: ' + config.version);

    const library = await loadLibrary(deps);
    const current = (await deps.ml.readyModels()).image;
    const model = { model: current.name, version: current.revision };

    await assertCameraRead(deps, model);

    if (library.images.length === 0) throw new Error('No image has an embedding from the current image model: ' + model.model);

    const prompts = await embedPrompts(deps.ml, model, config);
    const promptRaws = library.images.map((image) => scoreKinds(image.embedding, prompts, config.aggregate));
    const snapshot = buildSeedSet(
        library.images.map((image) => ({ id: image.id, embedding: image.embedding, rules: toSeedRules(image) })),
        promptRaws,
        config.prototypes,
    );

    await storeSeedSet(deps.db, config.version, model, snapshot, options.replace ?? false);

    const count = (kind: string) => snapshot.seeds.filter((seed) => seed.kind === kind).length;

    return [
        `Seed set for classifier ${config.version} stored (image model ${model.model} ${model.version}) from ${library.images.length} image(s)`,
        `left out (embedded by another image model): ${library.otherModel}  file unreadable (stored camera columns used): ${library.unreadable}`,
        ...SEED_KINDS.map(
            (kind) =>
                `  ${kind.padEnd(12)}${count(kind)} seed(s)${snapshot.stats.scored.includes(kind) ? '' : `  (fewer than ${MIN_SEEDS}: scored by the prompts alone)`}`,
        ),
    ];
}

/**
 * The seeds are chosen with camera evidence read from the stored files, while a verdict at runtime reads the camera
 * columns. Until the camera backfill has filled them the two can differ, so refuse while any image is unread.
 */
async function assertCameraRead(deps: TuneDeps, model: { model: string; version: string }): Promise<void> {
    const { rows } = await sql<{ unread: string }>`
        SELECT count(*)::text AS unread
        FROM documents d
        JOIN document_image_embeddings e ON e.document_id = d.id
        WHERE d.deleted_at IS NULL AND d.mime_type LIKE 'image/%' AND d.camera_read_at IS NULL
            AND e.model = ${model.model} AND e.model_version = ${model.version}
    `.execute(deps.db);
    const unread = Number(rows[0]?.unread ?? 0);

    if (unread > 0) throw new Error('The camera backfill has not read every image yet: ' + unread + ' left, run the snapshot after it');
}
