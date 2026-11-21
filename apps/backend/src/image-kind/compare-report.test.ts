import { describe, expect, it } from 'vitest';
import { agrees, buildReport, evaluateBar, type ComparisonRow } from './compare-report';
import { IMAGE_KINDS } from './kinds';

const NO_CAPTURE = { takenAt: false, gps: false, make: false, model: false, lens: false };

function row(overrides: Partial<ComparisonRow> & { id: string }): ComparisonRow {
    return {
        filename: overrides.id + '.jpg',
        category: 'photo',
        hasMeaningfulText: false,
        kind: 'photo',
        scores: Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, kind === 'photo' ? 0.3 : 0.1])),
        classifierVersion: 'v1',
        capture: NO_CAPTURE,
        ...overrides,
    };
}

/** The lines of one report section, up to the next blank line. */
function sectionOf(report: string, title: string): string {
    const start = report.indexOf(title);

    return report.slice(start, report.indexOf('\n\n', start) === -1 ? undefined : report.indexOf('\n\n', start));
}

describe('agrees', () => {
    it.each([
        ['photo', 'photo', true],
        ['photo', 'screenshot', false],
        ['screenshot', 'screenshot', true],
        ['screenshot', 'other', false],
        ['diagram', 'graphic', true],
        ['diagram', 'photo', false],
        ['document', 'letter', true],
        ['receipt', 'receipt', true],
        ['receipt', 'invoice', false],
        ['receipt', 'bank_statement', false],
        ['document', 'bank_statement', true],
        ['document', 'receipt', false],
        ['document', 'photo', false],
        ['document', 'screenshot', false],
        ['other', 'photo', false],
    ] as const)('verdict %s against category %s is %s', (kind, category, expected) => {
        expect(agrees(kind, category)).toBe(expected);
    });

    it('never agrees with an unknown category', () => {
        expect(agrees('photo', null)).toBe(false);
    });
});

describe('buildReport', () => {
    const rows: ComparisonRow[] = [
        row({ id: 'agree-photo' }),
        row({
            id: 'camera-doc',
            kind: 'document',
            category: 'photo',
            capture: { ...NO_CAPTURE, takenAt: true, make: true },
            scores: { photo: 0.2, document: 0.5 },
        }),
        row({ id: 'camera-doc-with-text', kind: 'document', category: 'letter', hasMeaningfulText: true, capture: { ...NO_CAPTURE, gps: true } }),
        row({ id: 'date-only-screenshot', kind: 'screenshot', category: 'screenshot', capture: { ...NO_CAPTURE, takenAt: true } }),
        row({ id: 'photo-as-screenshot', kind: 'screenshot', category: 'photo' }),
        row({ id: 'gps-no-make', kind: 'photo', category: 'photo', capture: { ...NO_CAPTURE, gps: true } }),
        row({ id: 'pending', kind: null, scores: null, classifierVersion: null, category: 'screenshot' }),
    ];
    const report = buildReport(rows);

    it('counts images with and without a verdict', () => {
        expect(report).toContain('images: 7  with verdict: 6  without verdict (no embedding yet, or ML off): 1');
        expect(report).toContain('classifier version(s): v1');
    });

    it('lists a camera image without text and a non-photo verdict under privacy 1 only', () => {
        const privacy = sectionOf(report, 'PRIVACY 1');

        expect(privacy).toContain('PRIVACY 1: camera evidence (make, model, lens or GPS), no meaningful text, non-photo verdict: 1');
        expect(privacy).toContain('camera-doc');
        expect(privacy).not.toContain('camera-doc-with-text');
        expect(privacy).not.toContain('agree-photo');
        expect(privacy).not.toContain('date-only-screenshot');
    });

    it('lists current photos with a non-photo verdict under privacy 2', () => {
        const privacy = sectionOf(report, 'PRIVACY 2');

        expect(privacy).toContain('PRIVACY 2: currently categorised photo, non-photo verdict: 2');
        expect(privacy).toContain('photo-as-screenshot');
        expect(privacy).toContain('camera-doc.jpg');
    });

    it('lists every disagreement with its scores, and not the agreements', () => {
        const disagreements = sectionOf(report, 'All disagreements');

        expect(disagreements).toContain('All disagreements (verdict vs current category): 2');
        expect(disagreements).toContain('camera-doc  camera-doc.jpg  category=photo  verdict=document');
        expect(disagreements).toContain('photo=0.200 screenshot=0.000 document=0.500');
        expect(disagreements).not.toContain('agree-photo');
        expect(disagreements).not.toContain('camera-doc-with-text');
    });

    it('counts the images that have only a capture date', () => {
        expect(report).toContain('Date only: 1 verdict(s) have a capture date but no make, model, lens or GPS');
    });

    it('prints the flip bar and the paper categories by verdict', () => {
        expect(report).toContain('Flip bar: NOT MET');
        expect(report).toContain('[FAIL] no camera image without text left photo (the first privacy list): 1 image(s)');
        expect(report).toContain('letter');
    });

    it('lists the images still without a verdict', () => {
        expect(sectionOf(report, 'Images without a verdict')).toContain('pending');
    });

    it('prints a verdict by category table', () => {
        expect(report).toContain('verdict \\ category');
    });

    it('is a readable report for an empty library', () => {
        expect(buildReport([])).toContain('images: 0  with verdict: 0');
    });
});

describe('evaluateBar', () => {
    const camera = { ...NO_CAPTURE, make: true };
    const screenshots = (hits: number, total: number) =>
        Array.from({ length: total }, (_, i) => row({ id: `s${i}`, category: 'screenshot', kind: i < hits ? 'screenshot' : 'photo' }));
    const statement = (kind: 'document' | 'receipt') => row({ id: 'st-' + kind, category: 'bank_statement', kind, hasMeaningfulText: true });
    const passes = (rows: ComparisonRow[]) => evaluateBar(rows).map((check) => check.pass);

    it('passes when every check holds', () => {
        expect(passes([...screenshots(40, 45), row({ id: 'p', capture: camera }), statement('document')])).toEqual([true, true, true, true]);
    });

    it('fails the screenshot check below 40 of 45', () => {
        expect(passes(screenshots(39, 45))[2]).toBe(false);
    });

    it('fails when a statement reads as a receipt', () => {
        expect(passes([statement('receipt')])[3]).toBe(false);
    });

    it('fails both camera checks for a current photo with camera evidence and no text that went non-photo', () => {
        expect(passes([row({ id: 'c', kind: 'document', capture: camera })]).slice(0, 2)).toEqual([false, false]);
    });

    it('does not fail the camera checks for a photo with only a capture date', () => {
        expect(passes([row({ id: 'd', kind: 'screenshot', capture: { ...NO_CAPTURE, takenAt: true } })]).slice(0, 2)).toEqual([true, true]);
    });
});
