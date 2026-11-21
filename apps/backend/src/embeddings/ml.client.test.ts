import { describe, expect, it } from 'vitest';
import { createMlClient, MlRejectedError, MlUnavailableError } from './ml.client';

const ready = {
    ready: true,
    device: 'cpu',
    error: null,
    models: { text: { name: 't', revision: 'r', dimensions: 4 }, image: { name: 'i', revision: 'r', dimensions: 4 } },
};

function clientFor(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
        calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });

        return respond(String(input), init);
    }) as typeof fetch;

    return { client: createMlClient('http://ml:8090', 1000, fetchImpl), calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ml client', () => {
    it('returns the loaded models once the service is ready', async () => {
        const { client } = clientFor(() => json(ready));

        await expect(client.readyModels()).resolves.toEqual({ text: ready.models.text, image: ready.models.image });
    });

    it('treats a service that is still loading as unavailable, so the queue retries', async () => {
        const { client } = clientFor(() => json({ ...ready, ready: false, models: {} }));

        await expect(client.readyModels()).rejects.toBeInstanceOf(MlUnavailableError);
    });

    it('treats a refused connection and a 503 as unavailable', async () => {
        const down = clientFor(() => Promise.reject(new TypeError('fetch failed')));
        const loading = clientFor(() => json({ detail: 'loading' }, 503));

        await expect(down.client.health()).rejects.toBeInstanceOf(MlUnavailableError);
        await expect(loading.client.embedTexts(['a'], 'passage')).rejects.toBeInstanceOf(MlUnavailableError);
    });

    it('treats a 422 as a refusal that retrying cannot fix', async () => {
        const { client } = clientFor(() => json({ detail: 'bad image' }, 422));

        await expect(client.embedImages([Buffer.from('x')])).rejects.toBeInstanceOf(MlRejectedError);
    });

    it('posts texts with their role, and images as base64', async () => {
        const { client, calls } = clientFor(() => json({ model: ready.models.text, embeddings: [[1, 0, 0, 0]] }));

        await client.embedTexts(['hei'], 'passage');
        await client.embedImages([Buffer.from('abc')]);

        expect(calls[0]).toEqual({ url: 'http://ml:8090/embed/text', body: { texts: ['hei'], role: 'passage' } });
        expect(calls[1]).toEqual({ url: 'http://ml:8090/embed/image', body: { images: [Buffer.from('abc').toString('base64')] } });
    });
});
