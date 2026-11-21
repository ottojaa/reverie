import { IMAGE_KINDS, type ImageKind } from './kinds';

/** One image document with its stored verdict, as the comparison reads it. No pixels, no OCR text. */
export interface ComparisonRow {
    id: string;
    filename: string;
    category: string | null;
    hasMeaningfulText: boolean;
    kind: ImageKind | null;
    scores: Record<string, number> | null;
    classifierVersion: string | null;
    /** EXIF facts present, without their values. */
    capture: { takenAt: boolean; gps: boolean; make: boolean; model: boolean; lens: boolean };
}

const VISUAL_CATEGORIES = ['photo', 'screenshot', 'graphic'];

/** Whether the current category is one the verdict would stand for: paper-like kinds match any non-visual category. */
export function agrees(kind: ImageKind, category: string | null): boolean {
    if (category === null) return false;

    if (kind === 'photo') return category === 'photo';

    if (kind === 'screenshot') return category === 'screenshot';

    if (kind === 'diagram') return category === 'graphic';

    return !VISUAL_CATEGORIES.includes(category);
}

const hasCameraDate = (row: ComparisonRow) => row.capture.takenAt || row.capture.gps;

const hasMakeOrModel = (row: ComparisonRow) => row.capture.make || row.capture.model;

function formatScores(scores: Record<string, number> | null): string {
    if (!scores) return '-';

    return IMAGE_KINDS.map((kind) => `${kind}=${(scores[kind] ?? 0).toFixed(3)}`).join(' ');
}

function formatRow(row: ComparisonRow): string {
    const camera = Object.entries(row.capture)
        .filter(([, present]) => present)
        .map(([name]) => name)
        .join(',');

    return `  ${row.id}  ${row.filename}  category=${row.category ?? 'null'}  verdict=${row.kind}  text=${row.hasMeaningfulText ? 'yes' : 'no'}  camera=[${camera}]\n      ${formatScores(row.scores)}`;
}

function section(title: string, rows: ComparisonRow[]): string[] {
    return ['', `${title}: ${rows.length}`, ...rows.map(formatRow)];
}

function matrix(rows: ComparisonRow[]): string[] {
    const categories = [...new Set(rows.map((row) => row.category ?? 'null'))].sort();
    const cell = (kind: ImageKind, category: string) => rows.filter((row) => row.kind === kind && (row.category ?? 'null') === category).length;
    const header = ['verdict \\ category', ...categories].map((name) => name.padEnd(18)).join('');
    const lines = IMAGE_KINDS.map((kind) => [kind, ...categories.map((category) => String(cell(kind, category)))].map((value) => value.padEnd(18)).join(''));

    return [header, ...lines];
}

/**
 * The shadow-mode comparison: verdicts against today's categories. Pure, so it is tested on fixed rows.
 * The privacy lists are the ones to read first: a camera image with no text, or a current photo, that got a
 * non-photo verdict is what the flip would change for the LLM gate.
 */
export function buildReport(rows: ComparisonRow[]): string {
    const judged = rows.filter((row) => row.kind !== null);
    const unjudged = rows.filter((row) => row.kind === null);
    const disagreements = judged.filter((row) => !agrees(row.kind!, row.category));
    const cameraNoText = judged.filter((row) => row.kind !== 'photo' && hasCameraDate(row) && !row.hasMeaningfulText);
    const currentPhotos = judged.filter((row) => row.kind !== 'photo' && row.category === 'photo');
    const uncaptured = judged.filter((row) => hasCameraDate(row) && !hasMakeOrModel(row));
    const versions = [...new Set(judged.map((row) => row.classifierVersion))].join(', ') || '-';

    return [
        'Image kind comparison (read-only, shadow verdicts vs document_category)',
        `images: ${rows.length}  with verdict: ${judged.length}  without verdict (no embedding yet, or ML off): ${unjudged.length}`,
        `classifier version(s): ${versions}`,
        '',
        ...matrix(judged),
        ...section('PRIVACY 1: camera EXIF (capture date or GPS), no meaningful text, non-photo verdict', cameraNoText),
        ...section('PRIVACY 2: currently categorised photo, non-photo verdict', currentPhotos),
        ...section('All disagreements (verdict vs current category)', disagreements),
        '',
        `Caveat: ${uncaptured.length} verdict(s) have a capture date or GPS but no camera make or model. Those columns are only filled for images`,
        'OCR-processed after this change, so older images were classified with a weaker camera prior than new uploads get.',
        ...section('Images without a verdict', unjudged),
    ].join('\n');
}
