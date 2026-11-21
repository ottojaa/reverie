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
    /** Texts received by embedImageTexts, in call order. */
    imageTextCalls: string[][];
    /** Flip to simulate reverie-ml going down (or coming back). */
    setDown(down: boolean): void;
    /** Make the next image request be refused as undecodable. */
    rejectImages(reject: boolean): void;
    setTextRevision(revision: string): void;
    /** Decide the vector embedImageTexts returns for a text (default: a distinct unit vector per position). */
    setImageTextEmbedder(embedder: (text: string, index: number) => number[]): void;
    /** Change the image model's revision, as a model upgrade in reverie-ml would. */
    setImageRevision(revision: string): void;
}

const unit = (dimensions: number, seed: number): number[] => Array.from({ length: dimensions }, (_, i) => (i === seed % dimensions ? 1 : 0));

/** A reverie-ml stand-in with real vector sizes, so the pgvector columns are exercised for real. */
export function createFakeMl(): FakeMl {
    let down = false;
    let rejectImage = false;
    let textModel = TEXT_MODEL;
    let imageModel = IMAGE_MODEL;
    let imageTextEmbedder = (_text: string, index: number) => unit(IMAGE_DIMENSIONS, index);
    const fake: FakeMl = {
        textCalls: [],
        imageCalls: 0,
        imageTextCalls: [],
        setDown: (value) => void (down = value),
        rejectImages: (value) => void (rejectImage = value),
        setTextRevision: (revision) => void (textModel = { ...TEXT_MODEL, revision }),
        setImageTextEmbedder: (embedder) => void (imageTextEmbedder = embedder),
        setImageRevision: (revision) => void (imageModel = { ...IMAGE_MODEL, revision }),
        async health() {
            if (down) throw new MlUnavailableError('reverie-ml is unreachable: test');

            return { ready: true, device: 'cpu', error: null, models: { text: textModel, image: imageModel } };
        },
        async readyModels() {
            if (down) throw new MlUnavailableError('reverie-ml is unreachable: test');

            return { text: textModel, image: imageModel };
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

            return { model: imageModel, embeddings: images.map((_, i) => unit(IMAGE_DIMENSIONS, i)) };
        },
        async embedImageTexts(texts) {
            if (down) throw new MlUnavailableError('reverie-ml is unreachable: test');

            fake.imageTextCalls.push(texts);

            return { model: imageModel, embeddings: texts.map((text, i) => imageTextEmbedder(text, i)) };
        },
    };

    return fake;
}
