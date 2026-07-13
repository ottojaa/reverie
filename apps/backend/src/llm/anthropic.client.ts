/**
 * Anthropic (Claude) Client Wrapper
 *
 * Provides typed methods for calling the Anthropic Messages API for document
 * processing. This is the single integration seam for all LLM features:
 * - Per-document summarization / metadata extraction (Claude Haiku 4.5)
 * - Image description / vision (Claude Haiku 4.5)
 * - The organize assistant streams via getAnthropicClient() directly
 *   (see services/organize.service.ts) — it needs tools, thinking, and caching.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import type { LlmPrompt, LlmSummaryResponse, VisionResponse } from './types';

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

const EMPTY_JSON_RETRY_SUFFIX = `

IMPORTANT:
- Return a valid JSON object only (no markdown, no prose).
- Keep output compact.
- Required keys: "summary", "entities", "topics".
- If uncertain, return best-effort values and keep arrays short.`;

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
 * The prompt (see prompt-builder.ts) already instructs the model to return
 * strict JSON in a fixed shape; we parse the text response with a tolerant
 * parser and retry once with a JSON-only nudge on empty/malformed output.
 */
export async function summarizeDocument(prompt: LlmPrompt): Promise<{ result: LlmSummaryResponse; tokenCount: number }> {
    const client = getAnthropicClient();
    const maxOutputTokens = Math.max(256, Math.min(prompt.maxTokens, env.LLM_MAX_OUTPUT_TOKENS));
    const retries = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const requestStart = Date.now();
        const isRetry = attempt > 0;
        const attemptMaxTokens = isRetry ? Math.max(256, Math.floor(maxOutputTokens * 0.6)) : maxOutputTokens;
        const userPrompt = isRetry ? `${prompt.user}${EMPTY_JSON_RETRY_SUFFIX}` : prompt.user;

        try {
            const message = await client.messages.create({
                model: env.ANTHROPIC_SUMMARY_MODEL,
                max_tokens: attemptMaxTokens,
                system: prompt.system,
                messages: [{ role: 'user', content: userPrompt }],
            });

            const content = extractText(message);

            if (process.env.NODE_ENV !== 'production') {
                console.info(
                    '[Anthropic] text_summary timings',
                    JSON.stringify({
                        model: env.ANTHROPIC_SUMMARY_MODEL,
                        attempt: attempt + 1,
                        retries,
                        requestMs: Date.now() - requestStart,
                        promptChars: prompt.system.length + userPrompt.length,
                        maxOutputTokens: attemptMaxTokens,
                        stopReason: message.stop_reason,
                        usage: message.usage,
                    }),
                );
            }

            if (content) {
                const result = parseJsonResponse<LlmSummaryResponse>(content);

                if (!result.summary || typeof result.summary !== 'string') {
                    throw new Error('Invalid response: missing summary field');
                }

                return {
                    result: {
                        summary: result.summary,
                        title: result.title,
                        document_type: result.document_type,
                        language: result.language,
                        entities: result.entities ?? [],
                        topics: result.topics ?? [],
                        extracted_date: result.extracted_date,
                    },
                    tokenCount: totalTokens(message.usage),
                };
            }

            lastError = new Error('Anthropic returned empty response');
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Anthropic request failed');
        }
    }

    throw lastError ?? new Error('Anthropic request failed');
}

/**
 * Call Claude vision for image description.
 */
export async function describeImage(imageBase64: string, mimeType: string, prompt: string): Promise<{ result: VisionResponse; tokenCount: number }> {
    const client = getAnthropicClient();
    const requestStart = Date.now();

    const message = await client.messages.create({
        model: env.ANTHROPIC_VISION_MODEL,
        max_tokens: 1000,
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

    if (process.env.NODE_ENV !== 'production') {
        console.info(
            '[Anthropic] vision_describe timings',
            JSON.stringify({
                model: env.ANTHROPIC_VISION_MODEL,
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
    };
}
