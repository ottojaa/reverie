import { MlRejectedError, MlUnavailableError, type MlClient, type MlModelInfo } from '../embeddings/ml.client';

/** Must match the vector sizes in migration 017_embeddings. */
export const TEXT_DIMENSIONS = 1024;
export const IMAGE_DIMENSIONS = 1152;

export const TEXT_MODEL: MlModelInfo = { name: 'fake-text', revision: 'rev-1', dimensions: TEXT_DIMENSIONS };
export const IMAGE_MODEL: MlModelInfo = { name: 'fake-image', revision: 'rev-1', dimensions: IMAGE_DIMENSIONS };

export interface FakeMl extends MlClient {
    /** Texts received by embedTexts, in call order. */
    textCalls: string[][];
    imageCalls: number;
    /** Flip to simulate reverie-ml going down (or coming back). */
    setDown(down: boolean): void;
    /** Make the next image request be refused as undecodable. */
    rejectImages(reject: boolean): void;
    setTextRevision(revision: string): void;
}

const unit = (dimensions: number, seed: number): number[] => Array.from({ length: dimensions }, (_, i) => (i === seed % dimensions ? 1 : 0));

/** A reverie-ml stand-in with real vector sizes, so the pgvector columns are exercised for real. */
export function createFakeMl(): FakeMl {
    let down = false;
    let rejectImage = false;
    let textModel = TEXT_MODEL;
    const fake: FakeMl = {
        textCalls: [],
        imageCalls: 0,
        setDown: (value) => void (down = value),
        rejectImages: (value) => void (rejectImage = value),
        setTextRevision: (revision) => void (textModel = { ...TEXT_MODEL, revision }),
        async health() {
            if (down) throw new MlUnavailableError('reverie-ml is unreachable: test');

            return { ready: true, device: 'cpu', error: null, models: { text: textModel, image: IMAGE_MODEL } };
        },
        async readyModels() {
            if (down) throw new MlUnavailableError('reverie-ml is unreachable: test');

            return { text: textModel, image: IMAGE_MODEL };
        },
        async embedTexts(texts) {
            if (down) throw new MlUnavailableError('reverie-ml is unreachable: test');

            fake.textCalls.push(texts);

            return { model: textModel, embeddings: texts.map((_, i) => unit(TEXT_DIMENSIONS, i)) };
        },
        async embedImages(images) {
            if (down) throw new MlUnavailableError('reverie-ml is unreachable: test');

            if (rejectImage) throw new MlRejectedError('reverie-ml rejected the request: undecodable image');

            fake.imageCalls += 1;

            return { model: IMAGE_MODEL, embeddings: images.map((_, i) => unit(IMAGE_DIMENSIONS, i)) };
        },
    };

    return fake;
}
