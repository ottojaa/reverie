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

/** The categories of printed paper that must read as `document` and not as a till slip: statements, invoices, forms, letters. */
export const PAPER_CATEGORIES = ['bank_statement', 'stock_statement', 'invoice', 'form', 'letter', 'certificate', 'contract'];

/**
 * Whether the current category is one the verdict would stand for. A receipt is a till slip, so it agrees only with
 * the `receipt` category: a bank statement or an invoice with a receipt verdict is a disagreement. `document` stands
 * for every other text category.
 */
export function agrees(kind: ImageKind, category: string | null): boolean {
    if (category === null) return false;

    if (kind === 'photo') return category === 'photo';

    if (kind === 'screenshot') return category === 'screenshot';

    if (kind === 'diagram') return category === 'graphic';

    if (kind === 'receipt') return category === 'receipt';

    if (kind === 'document') return !VISUAL_CATEGORIES.includes(category) && category !== 'receipt';

    return !VISUAL_CATEGORIES.includes(category);
}

/** Camera evidence: make, model, lens or GPS. A capture date alone is not (Android writes one into screenshots). */
export const hasCameraEvidence = (row: ComparisonRow) => row.capture.gps || row.capture.make || row.capture.model || row.capture.lens;

const hasDateOnly = (row: ComparisonRow) => row.capture.takenAt && !hasCameraEvidence(row);

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

interface BarCheck {
    name: string;
    detail: string;
    pass: boolean;
}

/** The four checks the flip needs. Pure over the rows, so the tuner prints the same block for every prompt set. */
export function evaluateBar(rows: ComparisonRow[]): BarCheck[] {
    const judged = rows.filter((row) => row.kind !== null);
    const privacy1 = judged.filter((row) => row.kind !== 'photo' && hasCameraEvidence(row) && !row.hasMeaningfulText);
    const cameraPhotos = judged.filter((row) => row.kind !== 'photo' && row.category === 'photo' && hasCameraEvidence(row));
    const screenshots = rows.filter((row) => row.category === 'screenshot');
    const screenshotHits = screenshots.filter((row) => row.kind === 'screenshot');
    const statements = rows.filter((row) => row.category !== null && PAPER_CATEGORIES.includes(row.category));
    const statementHits = statements.filter((row) => row.kind === 'document');

    return [
        { name: 'no camera image without text left photo (the first privacy list)', detail: `${privacy1.length} image(s)`, pass: privacy1.length === 0 },
        { name: 'no current photo with camera evidence left photo', detail: `${cameraPhotos.length} image(s)`, pass: cameraPhotos.length === 0 },
        {
            name: 'at least 8 in 9 screenshots stay screenshot (40 of 45)',
            detail: `${screenshotHits.length} of ${screenshots.length}`,
            pass: screenshotHits.length * 9 >= screenshots.length * 8,
        },
        {
            name: 'statements, invoices, forms and letters read as document',
            detail: `${statementHits.length} of ${statements.length}`,
            pass: statementHits.length === statements.length,
        },
    ];
}

/** The verdict counts for each text category: shows at a glance whether paper reads as document or receipt. */
function paperByCategory(rows: ComparisonRow[]): string[] {
    const paper = rows.filter((row) => row.kind !== null && row.category !== null && !VISUAL_CATEGORIES.includes(row.category));
    const categories = [...new Set(paper.map((row) => row.category!))].sort();

    return categories.map((category) => {
        const counts = IMAGE_KINDS.map((kind) => [kind, paper.filter((row) => row.category === category && row.kind === kind).length] as const)
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => `${kind}=${count}`);

        return `  ${category.padEnd(18)}${counts.join(' ')}`;
    });
}

export function formatBar(rows: ComparisonRow[]): string[] {
    const checks = evaluateBar(rows);

    return [
        `Flip bar: ${checks.every((check) => check.pass) ? 'MET' : 'NOT MET'}`,
        ...checks.map((check) => `  [${check.pass ? 'pass' : 'FAIL'}] ${check.name}: ${check.detail}`),
        'Paper categories by verdict:',
        ...paperByCategory(rows),
    ];
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
    const cameraNoText = judged.filter((row) => row.kind !== 'photo' && hasCameraEvidence(row) && !row.hasMeaningfulText);
    const currentPhotos = judged.filter((row) => row.kind !== 'photo' && row.category === 'photo');
    const dateOnly = judged.filter(hasDateOnly);
    const versions = [...new Set(judged.map((row) => row.classifierVersion))].join(', ') || '-';

    return [
        'Image kind comparison (read-only, shadow verdicts vs document_category)',
        `images: ${rows.length}  with verdict: ${judged.length}  without verdict (no embedding yet, or ML off): ${unjudged.length}`,
        `classifier version(s): ${versions}`,
        '',
        ...matrix(judged),
        '',
        ...formatBar(rows),
        ...section('PRIVACY 1: camera evidence (make, model, lens or GPS), no meaningful text, non-photo verdict', cameraNoText),
        ...section('PRIVACY 2: currently categorised photo, non-photo verdict', currentPhotos),
        ...section('All disagreements (verdict vs current category)', disagreements),
        '',
        `Date only: ${dateOnly.length} verdict(s) have a capture date but no make, model, lens or GPS. A date alone is not camera evidence.`,
        ...section('Images without a verdict', unjudged),
    ].join('\n');
}
