/**
 * Anthropic (Claude) Client Wrapper
 *
 * Provides typed methods for calling the Anthropic Messages API for document
 * processing. This is the single integration seam for all LLM features:
 * - Per-document summarization / metadata extraction (Claude Haiku 5.5)
 * - Image description / vision (Claude Haiku 5.5)
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '../config/env';
import { estimateCostUsd, type LlmUsage } from './llm-cost';
import { LlmAnalysisSchema, type LlmAnalysis } from './llm-response.schema';
import type { LlmPrompt, VisionResponse } from './types';

let anthropicClient: Anthropic | null = null;

/**
 * Get or create the Anthropic client singleton.
 */
export function getAnthropicClient(): Anthropic {
    if (!anthropicClient) {
        if (!env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY is not configured');
        }

        anthropicClient = new Anthropic({
            apiKey: env.ANTHROPIC_API_KEY,
        });
    }

    return anthropicClient;
}

/**
 * Check if the LLM (Anthropic) is available.
 */
export function isLlmAvailable(): boolean {
    return !!env.ANTHROPIC_API_KEY && env.LLM_ENABLED;
}

/**
 * Check if vision processing is available.
 */
export function isVisionAvailable(): boolean {
    return isLlmAvailable() && env.LLM_VISION_ENABLED;
}

/** Image media types the Anthropic vision API accepts. */
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Concatenate the text blocks of a Claude message into a single string.
 */
function extractText(message: Anthropic.Message): string {
    return message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
}

function totalTokens(usage: Anthropic.Usage): number {
    return usage.input_tokens + usage.output_tokens;
}

export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmCallOptions {
    /** Overrides the configured model (used by the model-comparison harness). */
    model?: string;
    /** Overrides the configured thinking effort. */
    effort?: LlmEffort;
}

export interface LlmCallUsage {
    model: string;
    usage: LlmUsage;
    stopReason: string | null;
    /** Null when the model has no known price. */
    costUsd: number | null;
}

/**
 * Room for adaptive thinking on top of the output budget: thinking counts toward
 * max_tokens, and the Haiku 5.x tokenizer produces ~30% more tokens for the same
 * text. Added here, not in env, so an older .env that pins LLM_MAX_OUTPUT_TOKENS
 * still leaves room.
 */
const THINKING_HEADROOM_TOKENS = 8000;

/** Output budget for the vision description JSON, before thinking headroom. */
const VISION_OUTPUT_TOKENS = 1000;

/** Models that predate effort and reject `output_config.effort` with a 400. */
const EFFORT_UNSUPPORTED = /^claude-(haiku-[34]|3-)/;

/** Newer models think by default and take `effort`; Haiku 4.5 and older reject it. */
function isEffortCapable(model: string): boolean {
    return !EFFORT_UNSUPPORTED.test(model);
}

function toCallUsage(model: string, message: Anthropic.Message): LlmCallUsage {
    return { model, usage: message.usage, stopReason: message.stop_reason, costUsd: estimateCostUsd(model, message.usage) };
}

/**
 * One info line per call: model, effort, tokens and cost. Not gated on NODE_ENV,
 * so production logs carry the per-document spend.
 */
function logCallCost(kind: string, call: LlmCallUsage, effort: LlmEffort | undefined): void {
    console.info(
        '[Anthropic] ' + kind + ' cost',
        JSON.stringify({
            model: call.model,
            effort: effort ?? null,
            inputTokens: call.usage.input_tokens,
            outputTokens: call.usage.output_tokens,
            stopReason: call.stopReason,
            costUsd: call.costUsd,
        }),
    );
}

/**
 * Parse a JSON response from the model, with a fallback for fenced code blocks.
 */
export function parseJsonResponse<T>(content: string): T {
    try {
        return JSON.parse(content) as T;
    } catch {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);

        if (jsonMatch?.[1]) {
            return JSON.parse(jsonMatch[1].trim()) as T;
        }

        throw new Error('Failed to parse JSON response: ' + content.substring(0, 200));
    }
}

/**
 * Call Claude for document text summarization / metadata extraction.
 *
 * Uses structured outputs: the response is constrained to LlmAnalysisSchema and
 * validated by the SDK (`messages.parse`), so no tolerant text parsing is
 * needed. No sampling parameters are sent (API version 2026-10-21 rejects them).
 * On an unparseable result (or truncation) we retry once with identical params.
 */
export async function summarizeDocument(
    prompt: LlmPrompt,
    options: LlmCallOptions = {},
): Promise<{ result: LlmAnalysis; tokenCount: number; call: LlmCallUsage }> {
    const client = getAnthropicClient();
    const model = options.model ?? env.ANTHROPIC_SUMMARY_MODEL;
    const effort = isEffortCapable(model) ? (options.effort ?? env.ANTHROPIC_SUMMARY_EFFORT) : undefined;
    const outputBudget = Math.max(256, Math.min(prompt.maxTokens, env.LLM_MAX_OUTPUT_TOKENS));
    const maxOutputTokens = effort ? outputBudget + THINKING_HEADROOM_TOKENS : outputBudget;
    const retries = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const requestStart = Date.now();

        try {
            const message = await client.messages.parse({
                model,
                max_tokens: maxOutputTokens,
                system: prompt.system,
                messages: [{ role: 'user', content: prompt.user }],
                output_config: { format: zodOutputFormat(LlmAnalysisSchema), ...(effort && { effort }) },
            });
            const call = toCallUsage(model, message);

            logCallCost('text_summary', call, effort);

            if (process.env.NODE_ENV !== 'production') {
                console.info(
                    '[Anthropic] text_summary timings',
                    JSON.stringify({
                        model,
                        attempt: attempt + 1,
                        retries,
                        requestMs: Date.now() - requestStart,
                        promptChars: prompt.system.length + prompt.user.length,
                        maxOutputTokens,
                        stopReason: message.stop_reason,
                        usage: message.usage,
                    }),
                );
            }

            if (message.parsed_output) {
                return { result: message.parsed_output, tokenCount: totalTokens(message.usage), call };
            }

            lastError = new Error('Anthropic returned unparseable structured output: ' + (message.stop_reason ?? 'unknown'));
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Anthropic request failed');
        }
    }

    throw lastError ?? new Error('Anthropic request failed');
}

/**
 * Call Claude vision for image description.
 */
export async function describeImage(
    imageBase64: string,
    mimeType: string,
    prompt: string,
): Promise<{ result: VisionResponse; tokenCount: number; call: LlmCallUsage }> {
    const client = getAnthropicClient();
    const model = env.ANTHROPIC_VISION_MODEL;
    const effort = isEffortCapable(model) ? env.ANTHROPIC_SUMMARY_EFFORT : undefined;
    const requestStart = Date.now();

    const message = await client.messages.create({
        model,
        max_tokens: effort ? VISION_OUTPUT_TOKENS + THINKING_HEADROOM_TOKENS : VISION_OUTPUT_TOKENS,
        ...(effort && { output_config: { effort } }),
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `${prompt}

Respond in JSON format:
{
  "description": "Brief description of the image",
  "detected_objects": ["object1", "object2"],
  "scene_type": "outdoor|indoor|screenshot|artwork|other",
  "has_people": true/false
}`,
                    },
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mimeType as ImageMediaType,
                            data: imageBase64,
                        },
                    },
                ],
            },
        ],
    });

    const call = toCallUsage(model, message);

    logCallCost('vision_describe', call, effort);

    if (process.env.NODE_ENV !== 'production') {
        console.info(
            '[Anthropic] vision_describe timings',
            JSON.stringify({
                model,
                requestMs: Date.now() - requestStart,
                imageBytesApprox: Math.floor((imageBase64.length * 3) / 4),
                usage: message.usage,
            }),
        );
    }

    const content = extractText(message);

    if (!content) {
        throw new Error('Anthropic Vision returned empty response');
    }

    const result = parseJsonResponse<VisionResponse>(content);

    if (!result.description || typeof result.description !== 'string') {
        throw new Error('Invalid vision response: missing description field');
    }

    return {
        result: {
            description: result.description,
            detected_objects: result.detected_objects ?? [],
            scene_type: result.scene_type ?? 'other',
            has_people: result.has_people ?? false,
        },
        tokenCount: totalTokens(message.usage),
        call,
    };
}
