import { describe, expect, it } from 'vitest';
import { classifyImageKind as classifyWith, type KindFacts, type PromptEmbeddings } from './classifier';
import { IDENTITY_CALIBRATION, type KindClassifierConfig } from './classifier-config';
import { IMAGE_KINDS, type ImageKind } from './kinds';

/** A config of the test's own, so the cases do not move with the committed numbers. */
const TEST_CONFIG: KindClassifierConfig = {
    version: 'test',
    prompts: Object.fromEntries(IMAGE_KINDS.map((kind) => [kind, [kind]])) as Record<ImageKind, string[]>,
    aggregate: 'mean',
    calibration: IDENTITY_CALIBRATION,
    thresholds: { cameraPrior: 0.03, screenPrior: 0.03, margin: 0.02, paperOnCameraMargin: 0.04 },
};

function classifyImageKind(embedding: readonly number[], prompts: PromptEmbeddings, facts: KindFacts, config: KindClassifierConfig = TEST_CONFIG) {
    return classifyWith(embedding, prompts, facts, config);
}

/** Each kind owns one axis, and all of its prompts sit on it: an image's score for a kind is its weight on that axis. */
const PROMPTS = Object.fromEntries(IMAGE_KINDS.map((kind, axis) => [kind, [axisVector(axis), axisVector(axis)]])) as PromptEmbeddings;

function axisVector(axis: number): number[] {
    return IMAGE_KINDS.map((_, i) => (i === axis ? 1 : 0));
}

/** An image embedding from weights per kind (the rest zero). */
function image(weights: Partial<Record<ImageKind, number>>): number[] {
    return IMAGE_KINDS.map((kind) => weights[kind] ?? 0);
}

const NO_CAMERA: KindFacts = { camera: [], captureDate: false, width: 3000, height: 2000 };
const CAMERA: KindFacts = { camera: ['make', 'model'], captureDate: true, width: 4032, height: 3024 };
const IPHONE_SCREEN: KindFacts = { camera: [], captureDate: false, width: 1170, height: 2532 };

describe('classifyImageKind', () => {
    it.each(IMAGE_KINDS)('recognises %s when it clearly wins', (kind) => {
        const verdict = classifyImageKind(image({ [kind]: 0.4, photo: kind === 'photo' ? 0.4 : 0.1 }), PROMPTS, NO_CAMERA);

        expect(verdict.kind).toBe(kind);
        expect(Object.keys(verdict.scores).sort()).toEqual([...IMAGE_KINDS].sort());
    });

    it('scores a kind as the mean cosine over its prompts', () => {
        const prompts: PromptEmbeddings = { ...PROMPTS, receipt: [axisVector(3), axisVector(0)] };
        const verdict = classifyImageKind(image({ receipt: 0.4, photo: 0.2 }), prompts, NO_CAMERA);

        expect(verdict.scores.receipt).toBeCloseTo(0.3);
    });

    describe('photo bias', () => {
        it('keeps photo when another kind wins by less than the margin', () => {
            expect(classifyImageKind(image({ photo: 0.3, screenshot: 0.31 }), PROMPTS, NO_CAMERA).kind).toBe('photo');
        });

        it('leaves photo once another kind clears the margin', () => {
            expect(classifyImageKind(image({ photo: 0.3, screenshot: 0.34 }), PROMPTS, NO_CAMERA).kind).toBe('screenshot');
        });

        it('says photo when the best kind scores below photo', () => {
            const verdict = classifyImageKind(image({ photo: 0.3, diagram: 0.2 }), PROMPTS, NO_CAMERA);

            expect(verdict.kind).toBe('photo');
            expect(verdict.signals.margin).toBeLessThan(0);
        });
    });

    describe('camera facts', () => {
        it('raise photo: a screenshot-like image from a camera needs more than the plain margin', () => {
            const embedding = image({ photo: 0.3, screenshot: 0.34 });

            expect(classifyImageKind(embedding, PROMPTS, NO_CAMERA).kind).toBe('screenshot');
            expect(classifyImageKind(embedding, PROMPTS, CAMERA).kind).toBe('photo');
        });

        it('hold a camera image that only somewhat reads as paper as a photo', () => {
            const verdict = classifyImageKind(image({ photo: 0.3, document: 0.36 }), PROMPTS, CAMERA);

            expect(verdict.kind).toBe('photo');
            expect(verdict.signals.requiredMargin).toBeGreaterThan(0.03);
        });

        it('still give document to a camera image whose content clearly reads as paper', () => {
            const verdict = classifyImageKind(image({ photo: 0.3, document: 0.5 }), PROMPTS, CAMERA);

            expect(verdict.kind).toBe('document');
            expect(verdict.signals.camera).toEqual(['make', 'model']);
        });

        it('count GPS alone', () => {
            const embedding = image({ photo: 0.3, receipt: 0.5 });
            const gpsOnly: KindFacts = { camera: ['gps'], captureDate: false, width: null, height: null };

            expect(classifyImageKind(embedding, PROMPTS, gpsOnly).signals.camera).toEqual(['gps']);
            expect(classifyImageKind(embedding, PROMPTS, gpsOnly).kind).toBe('receipt');
        });

        it('ignore a lone capture date: it is recorded but does not raise photo', () => {
            const embedding = image({ photo: 0.3, screenshot: 0.34 });
            const dateOnly: KindFacts = { ...NO_CAMERA, captureDate: true };
            const verdict = classifyImageKind(embedding, PROMPTS, dateOnly);

            expect(verdict.kind).toBe('screenshot');
            expect(verdict.signals).toMatchObject({ camera: [], captureDate: true, requiredMargin: 0.02 });
            expect(verdict.scores.photo).toBeCloseTo(0.3);
        });

        it('let a date-only image take the screen-resolution prior', () => {
            const verdict = classifyImageKind(image({ photo: 0.3, screenshot: 0.3 }), PROMPTS, { ...IPHONE_SCREEN, captureDate: true });

            expect(verdict.kind).toBe('screenshot');
        });
    });

    describe('screen resolution', () => {
        it('raises screenshot for an exact device size without camera facts', () => {
            const embedding = image({ photo: 0.3, screenshot: 0.3 });

            expect(classifyImageKind(embedding, PROMPTS, NO_CAMERA).kind).toBe('photo');
            expect(classifyImageKind(embedding, PROMPTS, IPHONE_SCREEN).kind).toBe('screenshot');
            expect(classifyImageKind(embedding, PROMPTS, IPHONE_SCREEN).signals.screenResolution).toBe(true);
        });

        it('does not apply when the image has camera facts', () => {
            const verdict = classifyImageKind(image({ photo: 0.3, screenshot: 0.3 }), PROMPTS, { ...IPHONE_SCREEN, camera: ['make'] });

            expect(verdict.kind).toBe('photo');
            expect(verdict.signals.screenResolution).toBe(false);
        });
    });

    describe('the config', () => {
        it("maxes a kind's prompts when asked to, where the mean would dilute them", () => {
            const prompts: PromptEmbeddings = { ...PROMPTS, document: [axisVector(1), axisVector(5)] };
            const embedding = image({ photo: 0.3, screenshot: 0.4 });
            const mean = classifyImageKind(embedding, prompts, NO_CAMERA);
            const max = classifyImageKind(embedding, prompts, NO_CAMERA, { ...TEST_CONFIG, aggregate: 'max' });

            expect(mean.scores.document).toBeCloseTo(0.2);
            expect(max.scores.document).toBeCloseTo(0.4);
        });

        it('calibrates each kind with its offset and scale before the margin applies', () => {
            const embedding = image({ photo: 0.3, receipt: 0.34 });
            const calibrated = { ...TEST_CONFIG, calibration: { ...IDENTITY_CALIBRATION, receipt: { offset: 0.1, scale: 1 } } };

            expect(classifyImageKind(embedding, PROMPTS, NO_CAMERA).kind).toBe('receipt');

            const verdict = classifyImageKind(embedding, PROMPTS, NO_CAMERA, calibrated);

            expect(verdict.kind).toBe('photo');
            expect(verdict.scores.receipt).toBeCloseTo(0.24);
        });
    });
});
