/**
 * The seam between the background AI features and whatever model answers them. Summaries and image understanding call
 * a provider; which one is a setting (see provider-config.ts). A provider only turns a prompt into the structured
 * result: privacy, the photo rules, entity checks and storage live in the callers, so they hold for every provider.
 */
import type { ProcessingLane } from '@reverie/shared';
import type * as z from 'zod/v4';
import type { LlmUsage } from './llm-cost';
import type { LlmAnalysis, LlmImageUnderstanding } from './llm-response.schema';
import type { LlmPrompt } from './types';

export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmCallOptions {
    /** Overrides the configured model (used by the model-comparison harness). */
    model?: string;
    /** Overrides the configured thinking effort (Anthropic only). */
    effort?: LlmEffort;
    /** The asking document's lane. A local server takes one call at a time, and a background one waits behind every normal one. */
    lane?: ProcessingLane;
}

export interface LlmCallUsage {
    model: string;
    /** Null when the server reported no token counts: unknown, never invented. */
    usage: LlmUsage | null;
    stopReason: string | null;
    /** Null when the model has no known price, and always for a local server. */
    costUsd: number | null;
}

export interface PreparedImage {
    base64: string;
    mediaType: 'image/jpeg';
    width: number;
    height: number;
}

export interface TextCallResult {
    result: LlmAnalysis;
    /** Null when the server reported no token counts. */
    tokenCount: number | null;
    call: LlmCallUsage;
}

export interface ImageCallResult {
    result: LlmImageUnderstanding;
    tokenCount: number | null;
    call: LlmCallUsage;
}

export interface JsonCallResult<T> {
    value: T;
    call: LlmCallUsage;
}

export interface PingRequest {
    text: string;
    image?: PreparedImage;
}

export interface LlmProvider {
    /** Text summary of OCR text. An unusable answer throws a plain Error, so the queue retries. */
    summarize(prompt: LlmPrompt, options?: LlmCallOptions): Promise<TextCallResult>;
    /** One call that sees the image and its OCR text. An unusable answer throws NonRetryableJobError. */
    understand(image: PreparedImage, prompt: LlmPrompt, options?: LlmCallOptions): Promise<ImageCallResult>;
    /**
     * One answer in the shape of `schema`, for a short text request. `kind` names the call in the cost log.
     * An unusable answer throws a plain Error.
     */
    completeJson<T>(kind: string, prompt: LlmPrompt, schema: z.ZodType<T>, options?: LlmCallOptions): Promise<JsonCallResult<T>>;
    /** A tiny free-text request, for the admin's Test connection. Returns the model's reply. */
    ping(request: PingRequest): Promise<string>;
}

export function sumUsage(a: LlmUsage | null, b: LlmUsage | null): LlmUsage | null {
    if (!a || !b) return a ?? b;

    return { input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens };
}

export function toTokenCount(usage: LlmUsage | null): number | null {
    return usage ? usage.input_tokens + usage.output_tokens : null;
}
