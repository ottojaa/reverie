import { MlRejectedError, MlUnavailableError, type MlClient, type MlModelInfo } from '../embeddings/ml.client';

/** Must match the vector sizes in migration 017_embeddings. */
export const TEXT_DIMENSIONS = 1024;
export const IMAGE_DIMENSIONS = 1152;

export const TEXT_MODEL: MlModelInfo = { name: 'fake-text', revision: 'rev-1', dimensions: TEXT_DIMENSIONS };
export const IMAGE_MODEL: MlModelInfo = { name: 'fake-image', revision: 'rev-1', dimensions: IMAGE_DIMENSIONS };

export interface FakeMl extends MlClient {
    /** Texts received by embedTexts, in call order. */
    textCalls: string[][];
    /** Texts received by embedImageTexts, in call order. */
    imageTextCalls: string[][];
    imageCalls: number;
    /** Flip to simulate reverie-ml going down (or coming back). */
    setDown(down: boolean): void;
    /** Make the next image request be refused as undecodable. */
    rejectImages(reject: boolean): void;
    setTextRevision(revision: string): void;
    /** Decide the vector embedImageTexts returns for a text with no pinned vector (default: a distinct unit vector per position). */
    setImageTextEmbedder(embedder: (text: string, index: number) => number[]): void;
    /** Change the image model's revision, as a model upgrade in reverie-ml would. */
    setImageRevision(revision: string): void;
    /** Pin the vector a query text embeds to (text model), instead of the default one-hot vector. */
    setTextVector(text: string, vector: number[]): void;
    /** Pin the vector a query text embeds to through the image model's text tower. */
    setImageTextVector(text: string, vector: number[]): void;
    /** Make every text request take this long, to simulate a slow service. */
    setDelay(ms: number): void;
}

/** A vector with a single 1 at `seed`: orthogonal to every other seed, identical to the same one. */
export const unit = (dimensions: number, seed: number): number[] => Array.from({ length: dimensions }, (_, i) => (i === seed % dimensions ? 1 : 0));

/**
 * A unit vector whose cosine similarity to `unit(dimensions, seed)` is exactly `cosine`.
 * Its remainder sits on a spare axis, so it is orthogonal to every other `unit`.
 */
export function leaning(dimensions: number, seed: number, cosine: number): number[] {
    const vector = unit(dimensions, seed).map((value) => value * cosine);
    vector[dimensions - 1] = Math.sqrt(1 - cosine * cosine);

    return vector;
}

/** A reverie-ml stand-in with real vector sizes, so the pgvector columns are exercised for real. */
export function createFakeMl(): FakeMl {
    let down = false;
    let rejectImage = false;
    let delayMs = 0;
    let textModel = TEXT_MODEL;
    let imageModel = IMAGE_MODEL;
    let imageTextEmbedder = (_text: string, index: number) => unit(IMAGE_DIMENSIONS, index);
    const textVectors = new Map<string, number[]>();
    const imageTextVectors = new Map<string, number[]>();

    const assertUp = () => {
        if (down) throw new MlUnavailableError('reverie-ml is unreachable: test');
    };

    const wait = () => (delayMs ? new Promise<void>((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve());

    const fake: FakeMl = {
        textCalls: [],
        imageTextCalls: [],
        imageCalls: 0,
        setDown: (value) => void (down = value),
        rejectImages: (value) => void (rejectImage = value),
        setTextRevision: (revision) => void (textModel = { ...TEXT_MODEL, revision }),
        setImageTextEmbedder: (embedder) => void (imageTextEmbedder = embedder),
        setImageRevision: (revision) => void (imageModel = { ...IMAGE_MODEL, revision }),
        setTextVector: (text, vector) => void textVectors.set(text, vector),
        setImageTextVector: (text, vector) => void imageTextVectors.set(text, vector),
        setDelay: (ms) => void (delayMs = ms),
        async health() {
            assertUp();

            return { ready: true, device: 'cpu', error: null, models: { text: textModel, image: imageModel } };
        },
        async readyModels() {
            assertUp();

            return { text: textModel, image: imageModel };
        },
        async embedTexts(texts) {
            assertUp();
            fake.textCalls.push(texts);
            await wait();

            return { model: textModel, embeddings: texts.map((text, i) => textVectors.get(text) ?? unit(TEXT_DIMENSIONS, i)) };
        },
        async embedImageTexts(texts) {
            assertUp();
            fake.imageTextCalls.push(texts);
            await wait();

            return { model: imageModel, embeddings: texts.map((text, i) => imageTextVectors.get(text) ?? imageTextEmbedder(text, i)) };
        },
        async embedImages(images) {
            assertUp();

            if (rejectImage) throw new MlRejectedError('reverie-ml rejected the request: undecodable image');

            fake.imageCalls += 1;

            return { model: imageModel, embeddings: images.map((_, i) => unit(IMAGE_DIMENSIONS, i)) };
        },
    };

    return fake;
}
