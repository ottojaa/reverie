/**
 * The tuning run: scores prompt sets against the stored image embeddings and prints, for each, the same report as the
 * comparison plus the flip bar over a margin grid. Read-only: the library is loaded in one READ ONLY transaction and
 * everything after it happens in memory, so no verdict is written. Prompt embeddings come from reverie-ml (a call, not
 * a write). Every image's EXIF is read from its stored file in memory and fills the camera columns that are empty (a
 * stored value wins), as the backfill would, so the tables show the backfilled library whether or not the backfill has
 * run. It does not read `camera_read_at`, so it also runs on a database that has not had migration 020.
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import type { MlClient } from '../embeddings/ml.client.js';
import { extractExifMetadata, toPhotoMetadataValues } from '../ocr/exif-extractor.js';
import { decideKind, scoreKinds, toCameraFacts, type KindFacts, type PromptEmbeddings } from './classifier.js';
import { buildReport, evaluateBar, type ComparisonRow } from './compare-report.js';
import type { ImageKind } from './kinds.js';
import { IMAGE_KINDS } from './kinds.js';
import { IDENTITY_CALIBRATION, type KindCalibration } from './classifier-config.js';
import { marginsFor, measureKindStats, resolveCalibration, toConfig, type KindStats, type PromptSet } from './prompt-set.js';
import { embedPrompts } from './prompt-cache.js';
import { promptWeightsOf, scoreVariants, type PrototypeSettings, type PrototypeVariant, type Raw } from './prototype-run.js';

export interface TuneDeps {
    db: Kysely<Database>;
    ml: MlClient;
    readFile: (path: string) => Promise<Buffer>;
}

type Capture = ComparisonRow['capture'];

interface LibraryImage {
    id: string;
    filename: string;
    category: string | null;
    hasMeaningfulText: boolean;
    embedding: number[];
    width: number | null;
    height: number | null;
    capture: Capture;
}

export interface Library {
    images: LibraryImage[];
    /** Images with an embedding from another image model than reverie-ml serves now: left out, their prompts would not compare. */
    otherModel: number;
    /** Images whose file could not be read: classified with the camera facts already stored, if any. */
    unreadable: number;
}

const isMissingColumn = (value: string | number | null | undefined) => value === null || value === undefined || value === '';

/** The EXIF the stored file holds. Null when the file cannot be read; empty when it has no EXIF. */
async function readCaptureFromFile(deps: TuneDeps, path: string): Promise<Record<string, unknown> | null> {
    let buffer: Buffer;

    try {
        buffer = await deps.readFile(path);
    } catch {
        return null;
    }

    return toPhotoMetadataValues(await extractExifMetadata(buffer)) ?? {};
}

function toCapture(values: Record<string, unknown> | null, stored: Record<string, unknown>): Capture {
    const pick = (column: string) => (isMissingColumn(stored[column] as string | null) ? values?.[column] : stored[column]);

    return {
        takenAt: pick('taken_at') != null,
        gps: pick('latitude') != null && pick('longitude') != null,
        make: Boolean(pick('camera_make')),
        model: Boolean(pick('camera_model')),
        lens: Boolean(pick('lens_model')),
    };
}

/** Every live image with an embedding from the current image model, with the camera facts the backfill would give it. */
export async function loadLibrary(deps: TuneDeps): Promise<Library> {
    const current = (await deps.ml.readyModels()).image;
    const rows = await deps.db.transaction().execute(async (trx) => {
        await sql`SET TRANSACTION READ ONLY`.execute(trx);

        return trx
            .selectFrom('documents as d')
            .innerJoin('document_image_embeddings as e', 'e.document_id', 'd.id')
            .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
            .select([
                'd.id',
                'd.original_filename',
                'd.document_category',
                'd.has_meaningful_text',
                'd.file_path',
                'd.width',
                'd.height',
                sql<string>`e.embedding::text`.as('embedding'),
                'e.model',
                'e.model_version',
                'pm.taken_at',
                'pm.latitude',
                'pm.longitude',
                'pm.camera_make',
                'pm.camera_model',
                'pm.lens_model',
            ])
            .where('d.deleted_at', 'is', null)
            .where('d.mime_type', 'like', 'image/%')
            .orderBy('d.created_at')
            .orderBy('d.id')
            .execute();
    });
    const usable = rows.filter((row) => row.model === current.name && row.model_version === current.revision);
    let unreadable = 0;
    const images: LibraryImage[] = [];

    for (const row of usable) {
        const values = await readCaptureFromFile(deps, row.file_path);

        if (values === null) unreadable += 1;

        images.push({
            id: row.id,
            filename: row.original_filename,
            category: row.document_category,
            hasMeaningfulText: row.has_meaningful_text,
            embedding: JSON.parse(row.embedding) as number[],
            width: row.width,
            height: row.height,
            capture: toCapture(values, row),
        });
    }

    return { images, otherModel: rows.length - usable.length, unreadable };
}

/** The classifier's camera facts for an image's capture facts: make, model, lens and GPS count, a lone date does not. */
export function toKindFacts(image: Pick<LibraryImage, 'capture' | 'width' | 'height'>): KindFacts {
    const { capture } = image;
    const camera = toCameraFacts(capture);

    return { camera, captureDate: capture.takenAt, width: image.width, height: image.height };
}

function classifyAll(library: Library, raws: Raw[], set: PromptSet, calibration: Record<ImageKind, KindCalibration>, margin?: number): ComparisonRow[] {
    const config = toConfig(set, calibration);
    const thresholds =
        margin === undefined
            ? config.thresholds
            : { ...config.thresholds, margin, paperOnCameraMargin: Math.max(config.thresholds.paperOnCameraMargin, margin) };

    return library.images.map((image, i) => {
        const verdict = decideKind(raws[i]!, toKindFacts(image), { ...config, thresholds });

        return {
            id: image.id,
            filename: image.filename,
            category: image.category,
            hasMeaningfulText: image.hasMeaningfulText,
            kind: verdict.kind,
            scores: verdict.scores,
            classifierVersion: set.name,
            capture: image.capture,
        };
    });
}

function gridLine(label: string, margin: number, rows: ComparisonRow[]): string {
    const checks = evaluateBar(rows);
    const mark = checks.every((check) => check.pass) ? 'MET' : 'no ';

    return `  ${label}margin ${String(margin).padEnd(6)} ${mark}  ` + checks.map((check) => `${check.pass ? 'pass' : 'FAIL'}(${check.detail})`).join('  ');
}

const formatStats = (stats: Record<ImageKind, KindStats>) =>
    IMAGE_KINDS.map((kind) => `  ${kind.padEnd(12)}mean=${stats[kind].mean.toFixed(4)} std=${stats[kind].std.toFixed(4)}`);

interface SetScores {
    /** The base scoring first; the grid tries every one. */
    variants: PrototypeVariant[];
    /** Report lines about the scores: library stats for prompts, seed counts and the sources for prototypes. */
    notes: string[];
}

type Model = { model: string; version: string };

async function loadPromptRaws(deps: TuneDeps, library: Library, set: PromptSet, model: Model): Promise<Raw[]> {
    const prompts: PromptEmbeddings = await embedPrompts(deps.ml, model, set);

    return library.images.map((image) => scoreKinds(image.embedding, prompts, set.aggregate));
}

async function scoreWithPrompts(deps: TuneDeps, library: Library, set: PromptSet, model: Model): Promise<SetScores> {
    const raws = await loadPromptRaws(deps, library, set, model);
    const notes = ['Raw score per kind over the library (what offset and zscore calibrate with):', ...formatStats(measureKindStats(raws))];

    return { variants: [{ label: '', raws }], notes };
}

async function scoreWithPrototypes(deps: TuneDeps, library: Library, set: PromptSet, settings: PrototypeSettings, model: Model): Promise<SetScores> {
    // The prompts are only embedded (a call to reverie-ml) when some variant gives them a weight.
    const promptRaws = promptWeightsOf(settings).some((weight) => weight > 0) ? await loadPromptRaws(deps, library, set, model) : null;

    return scoreVariants(library.images, promptRaws, settings);
}

/** Scores one set over the library: its full report at its own thresholds, its score notes, and the margin grid. */
export async function tuneSet(deps: TuneDeps, library: Library, set: PromptSet, model: Model): Promise<string> {
    const { variants, notes } = set.prototypes
        ? await scoreWithPrototypes(deps, library, set, set.prototypes, model)
        : await scoreWithPrompts(deps, library, set, model);
    // A prototype set's scores are already z-scored and combined, so its calibration is the identity.
    const calibrationOf = (raws: Raw[]) => (set.prototypes ? IDENTITY_CALIBRATION : resolveCalibration(set.calibration, measureKindStats(raws)));
    const at = (variant: PrototypeVariant, margin?: number) => classifyAll(library, variant.raws, set, calibrationOf(variant.raws), margin);
    const grid = variants.flatMap((variant) =>
        marginsFor(set).map((margin) => gridLine(variant.label ? variant.label + '  ' : '', margin, at(variant, margin))),
    );

    return [
        '='.repeat(80),
        `Prompt set: ${set.name}  aggregate=${set.aggregate}  calibration=${typeof set.calibration === 'string' ? set.calibration : 'explicit'}`,
        `thresholds: ${JSON.stringify(set.thresholds)}`,
        ...notes,
        '',
        variants.length > 1 ? `Report for the base variant (${variants[0]!.label}); the grid below has them all.` : '',
        buildReport(at(variants[0]!)),
        '',
        'Margin grid (cameraPrior, screenPrior and paperOnCameraMargin as in the set, paperOnCameraMargin raised to the margin if lower):',
        ...grid,
    ].join('\n');
}

/** Runs every set and writes the output. Writes nothing to the database. */
export async function runTuning(deps: TuneDeps, sets: PromptSet[], write: (text: string) => void): Promise<void> {
    const library = await loadLibrary(deps);
    const current = (await deps.ml.readyModels()).image;
    const model = { model: current.name, version: current.revision };

    write(`Tuning ${sets.length} prompt set(s) over ${library.images.length} image(s) embedded by ${model.model} ${model.version}\n`);
    write(`left out (embedded by another image model): ${library.otherModel}  file unreadable: ${library.unreadable}\n`);

    for (const set of sets) write((await tuneSet(deps, library, set, model)) + '\n');
}
