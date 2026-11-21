import { describe, expect, it } from 'vitest';
import { agrees, buildReport, type ComparisonRow } from './compare-report';
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
        ['receipt', 'invoice', true],
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
        row({ id: 'camera-doc-with-text', kind: 'document', category: 'letter', hasMeaningfulText: true, capture: { ...NO_CAPTURE, takenAt: true } }),
        row({ id: 'photo-as-screenshot', kind: 'screenshot', category: 'photo' }),
        row({ id: 'gps-no-make', kind: 'photo', category: 'photo', capture: { ...NO_CAPTURE, gps: true } }),
        row({ id: 'pending', kind: null, scores: null, classifierVersion: null, category: 'screenshot' }),
    ];
    const report = buildReport(rows);

    it('counts images with and without a verdict', () => {
        expect(report).toContain('images: 6  with verdict: 5  without verdict (no embedding yet, or ML off): 1');
        expect(report).toContain('classifier version(s): v1');
    });

    it('lists a camera image without text and a non-photo verdict under privacy 1 only', () => {
        const privacy = sectionOf(report, 'PRIVACY 1');

        expect(privacy).toContain('PRIVACY 1: camera EXIF (capture date or GPS), no meaningful text, non-photo verdict: 1');
        expect(privacy).toContain('camera-doc');
        expect(privacy).not.toContain('camera-doc-with-text');
        expect(privacy).not.toContain('agree-photo');
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

    it('states the camera-facts caveat with the number of affected verdicts', () => {
        expect(report).toContain('Caveat: 2 verdict(s) have a capture date or GPS but no camera make or model');
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
