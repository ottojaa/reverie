/**
 * "Test connection" for the admin UI: one tiny request to the provider as the admin has typed it (not as saved: settings
 * are live, so a server is tried before real jobs are pointed at it). Never throws: a down server is the answer.
 */
import type { TestLlmConnectionRequest, TestLlmConnectionResponse } from '@reverie/shared';
import sharp from 'sharp';
import { describeMissingConfig, createProvider } from './provider-config';
import type { PreparedImage } from './provider';

const TEXT_PROMPT = 'Reply with the single word: ready';
const IMAGE_PROMPT = 'What colour is this image? Answer with one word.';
const MAX_TEXT_CHARS = 400;

/** A plain red 32 px square: enough for a model that sees images to name the colour, and a few dozen bytes on the wire. */
async function makeTestImage(): Promise<PreparedImage> {
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } })
        .jpeg()
        .toBuffer();

    return { base64: jpeg.toString('base64'), mediaType: 'image/jpeg', width: 32, height: 32 };
}

export async function testLlmConnection(draft: TestLlmConnectionRequest): Promise<TestLlmConnectionResponse> {
    const config = { provider: draft.provider, model: draft.model.trim(), baseUrl: draft.base_url.trim() };
    const result = { provider: config.provider, model: config.model };
    const startedAt = Date.now();
    const missing = describeMissingConfig(config);

    if (missing) return { ...result, ok: false, latency_ms: 0, reply: null, error: missing };

    try {
        const provider = createProvider(config);
        const request = draft.capability === 'image' ? { text: IMAGE_PROMPT, image: await makeTestImage() } : { text: TEXT_PROMPT };
        const reply = await provider.ping(request);

        return { ...result, ok: true, latency_ms: Date.now() - startedAt, reply: reply.slice(0, MAX_TEXT_CHARS), error: null };
    } catch (error) {
        // Provider errors are already free of the API key (see OpenAiCompatibleProvider).
        const message = error instanceof Error ? error.message : 'Unknown error';

        return { ...result, ok: false, latency_ms: Date.now() - startedAt, reply: null, error: message.slice(0, MAX_TEXT_CHARS) };
    }
}
