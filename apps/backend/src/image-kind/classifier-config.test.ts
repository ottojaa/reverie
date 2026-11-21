import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIND_CLASSIFIER } from './classifier-config';
import { parsePromptSet } from './prompt-set';

/** The tuning set that won round 2 on the server: what the committed classifier must stay equal to. */
const WINNER = parsePromptSet(JSON.parse(readFileSync(join(__dirname, '../../scripts/image-kind-sets/g-knn3-plus-prompts.json'), 'utf8')));

describe('the committed classifier', () => {
    it('is the set that met the flip bar on the server: its prompts, aggregate and thresholds', () => {
        expect(KIND_CLASSIFIER.version).toBe('v2');
        expect(KIND_CLASSIFIER.prompts).toEqual(WINNER.prompts);
        expect(KIND_CLASSIFIER.aggregate).toBe(WINNER.aggregate);
        expect(KIND_CLASSIFIER.thresholds).toEqual(WINNER.thresholds);
    });

    it('scores by the nearest 3 seeds at prompt weight 0.25', () => {
        // The winning variant is one of the set's grid points: k 3 is its base, weight 0.25 one of its extra weights.
        expect(WINNER.prototypes).toMatchObject({ method: 'knn', k: 3 });
        expect(WINNER.prototypes?.promptWeights).toContain(0.25);
        expect(KIND_CLASSIFIER.prototypes).toEqual({ k: 3, promptWeight: 0.25 });
    });
});
