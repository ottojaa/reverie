import { describe, expect, it } from 'vitest';
import { classifyImageKind, type KindFacts, type PromptEmbeddings } from './classifier';
import { IMAGE_KINDS, type ImageKind } from './kinds';

/** Each kind owns one axis, and all of its prompts sit on it: an image's score for a kind is its weight on that axis. */
const PROMPTS = Object.fromEntries(IMAGE_KINDS.map((kind, axis) => [kind, [axisVector(axis), axisVector(axis)]])) as PromptEmbeddings;

function axisVector(axis: number): number[] {
    return IMAGE_KINDS.map((_, i) => (i === axis ? 1 : 0));
}

/** An image embedding from weights per kind (the rest zero). */
function image(weights: Partial<Record<ImageKind, number>>): number[] {
    return IMAGE_KINDS.map((kind) => weights[kind] ?? 0);
}

const NO_CAMERA: KindFacts = { camera: [], width: 3000, height: 2000 };
const CAMERA: KindFacts = { camera: ['make', 'model', 'capture_date'], width: 4032, height: 3024 };
const IPHONE_SCREEN: KindFacts = { camera: [], width: 1170, height: 2532 };

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
            expect(verdict.signals.camera).toEqual(['make', 'model', 'capture_date']);
        });

        it('count a capture date or GPS alone', () => {
            const embedding = image({ photo: 0.3, receipt: 0.5 });

            expect(classifyImageKind(embedding, PROMPTS, { camera: ['gps'], width: null, height: null }).signals.camera).toEqual(['gps']);
            expect(classifyImageKind(embedding, PROMPTS, { camera: ['gps'], width: null, height: null }).kind).toBe('receipt');
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
});
