import { env } from '../config/env';

export interface MlModelInfo {
    name: string;
    revision: string;
    dimensions: number;
}

export interface MlHealth {
    ready: boolean;
    device: string;
    error: string | null;
    models: { text?: MlModelInfo; image?: MlModelInfo };
}

export interface MlEmbeddings {
    model: MlModelInfo;
    embeddings: number[][];
}

/** reverie-ml cannot serve right now (unreachable, loading models, erroring). Always worth retrying. */
export class MlUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MlUnavailableError';
    }
}

/** reverie-ml understood the request and refused it (e.g. an image it cannot decode). Retrying cannot help. */
export class MlRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MlRejectedError';
    }
}

export interface MlClient {
    health(): Promise<MlHealth>;
    /** The text and image models that would serve a request now. Throws MlUnavailableError until both are loaded. */
    readyModels(): Promise<{ text: MlModelInfo; image: MlModelInfo }>;
    embedTexts(texts: string[], role: 'passage' | 'query'): Promise<MlEmbeddings>;
    embedImages(images: Buffer[]): Promise<MlEmbeddings>;
}

type Fetch = typeof fetch;

export function createMlClient(baseUrl: string, timeoutMs: number, fetchImpl: Fetch = fetch): MlClient {
    async function call<T>(path: string, init?: RequestInit): Promise<T> {
        let response: Response;

        try {
            response = await fetchImpl(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(timeoutMs) });
        } catch (error) {
            throw new MlUnavailableError('reverie-ml is unreachable: ' + (error instanceof Error ? error.message : String(error)));
        }

        if (response.status === 413 || response.status === 422) {
            throw new MlRejectedError('reverie-ml rejected the request: ' + (await response.text()).slice(0, 200));
        }

        if (!response.ok) throw new MlUnavailableError(`reverie-ml answered ${response.status}: ` + (await response.text()).slice(0, 200));

        return (await response.json()) as T;
    }

    const post = <T>(path: string, body: unknown) =>
        call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const health = () => call<MlHealth>('/health');

    return {
        health,
        async readyModels() {
            const status = await health();
            const { text, image } = status.models;

            if (!status.ready || !text || !image) throw new MlUnavailableError('reverie-ml is still loading models');

            return { text, image };
        },
        embedTexts: (texts, role) => post<MlEmbeddings>('/embed/text', { texts, role }),
        embedImages: (images) => post<MlEmbeddings>('/embed/image', { images: images.map((image) => image.toString('base64')) }),
    };
}

let client: MlClient | null | undefined;

/** The shared client, or null when ML_URL is not set (embeddings off). */
export function getMlClient(): MlClient | null {
    if (client !== undefined) return client;

    client = env.ML_URL ? createMlClient(env.ML_URL, env.ML_TIMEOUT_MS) : null;

    return client;
}
