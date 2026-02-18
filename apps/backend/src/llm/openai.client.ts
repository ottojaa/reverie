/**
 * OpenAI Client Wrapper
 *
 * Provides typed methods for calling OpenAI API for document processing.
 */

import OpenAI from 'openai';
import { env } from '../config/env';
import type { LlmPrompt, LlmSummaryResponse, VisionResponse } from './types';

let openaiClient: OpenAI | null = null;

/**
 * Get or create the OpenAI client singleton
 */
export function getOpenAIClient(): OpenAI {
    if (!openaiClient) {
        if (!env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is not configured');
        }

        openaiClient = new OpenAI({
            apiKey: env.OPENAI_API_KEY,
        });
    }

    return openaiClient;
}

/**
 * Check if OpenAI API is available
 */
export function isOpenAIAvailable(): boolean {
    return !!env.OPENAI_API_KEY && env.LLM_ENABLED;
}

/**
 * Check if vision processing is available
 */
export function isVisionAvailable(): boolean {
    return isOpenAIAvailable() && env.LLM_VISION_ENABLED;
}

export interface ChatCompletionResult {
    content: string;
    tokenCount: number;
    model: string;
}

const EMPTY_JSON_RETRY_SUFFIX = `

IMPORTANT:
- Return a valid JSON object only (no markdown, no prose).
- Keep output compact.
- Required keys: "summary", "key_entities", "topics".
- If uncertain, return best-effort values and keep arrays short.`;

/**
 * Call OpenAI Chat Completion API for text summarization
 */
export async function callChatCompletion(prompt: LlmPrompt): Promise<ChatCompletionResult> {
    const client = getOpenAIClient();
    const maxCompletionTokens = Math.max(256, Math.min(prompt.maxTokens, env.OPENAI_MAX_TOKENS));
    const retries = Math.max(0, env.OPENAI_EMPTY_RESPONSE_RETRIES);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const requestStart = Date.now();
        const isRetry = attempt > 0;
        const attemptMaxTokens = isRetry ? Math.max(256, Math.floor(maxCompletionTokens * 0.6)) : maxCompletionTokens;
        const userPrompt = isRetry ? `${prompt.user}${EMPTY_JSON_RETRY_SUFFIX}` : prompt.user;

        try {
            const reasoning_effort = env.OPENAI_MODEL === 'gpt-5-mini' ? env.OPENAI_REASONING_EFFORT : null
            const response = await client.chat.completions.create({
                model: env.OPENAI_MODEL,
                messages: [
                    { role: 'system', content: prompt.system },
                    { role: 'user', content: userPrompt },
                ],
                max_completion_tokens: attemptMaxTokens,
                response_format: { type: 'json_object' },
                ...(reasoning_effort && { reasoning_effort })
            });

            const content = response.choices[0]?.message?.content?.trim();

            if (process.env.NODE_ENV !== 'production') {
                console.info(
                    '[OpenAI] text_summary timings',
                    JSON.stringify({
                        model: env.OPENAI_MODEL,
                        attempt: attempt + 1,
                        retries,
                        requestMs: Date.now() - requestStart,
                        promptChars: prompt.system.length + userPrompt.length,
                        maxCompletionTokens: attemptMaxTokens,
                        finishReason: response.choices[0]?.finish_reason ?? null,
                        usage: response.usage ?? null,
                    }),
                );
            }

            if (content) {
                return {
                    content,
                    tokenCount: response.usage?.total_tokens ?? 0,
                    model: response.model,
                };
            }

            lastError = new Error('OpenAI returned empty response');
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('OpenAI request failed');
        }
    }

    throw lastError ?? new Error('OpenAI request failed');
}

/**
 * Parse JSON response from OpenAI, with fallback for malformed JSON
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

        throw new Error(`Failed to parse JSON response: ${content.substring(0, 200)}`);
    }
}

/**
 * Call OpenAI for document text summarization
 */
export async function summarizeDocument(prompt: LlmPrompt): Promise<{ result: LlmSummaryResponse; tokenCount: number }> {
    const response = await callChatCompletion(prompt);
    const result = parseJsonResponse<LlmSummaryResponse>(response.content);

    // Validate required fields
    if (!result.summary || typeof result.summary !== 'string') {
        throw new Error('Invalid response: missing summary field');
    }

    // Provide defaults for optional fields
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
        tokenCount: response.tokenCount,
    };
}

/**
 * Call OpenAI Vision API for image description
 */
export async function describeImage(imageBase64: string, mimeType: string, prompt: string): Promise<{ result: VisionResponse; tokenCount: number }> {
    const client = getOpenAIClient();
    const requestStart = Date.now();

    const response = await client.chat.completions.create({
        model: env.LLM_VISION_MODEL,
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
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${imageBase64}`,
                        },
                    },
                ],
            },
        ],
        max_completion_tokens: 1000,
        response_format: { type: 'json_object' },
    });

    if (process.env.NODE_ENV !== 'production') {
        console.info(
            '[OpenAI] vision_describe timings',
            JSON.stringify({
                model: env.LLM_VISION_MODEL,
                requestMs: Date.now() - requestStart,
                imageBytesApprox: Math.floor((imageBase64.length * 3) / 4),
                usage: response.usage ?? null,
            }),
        );
    }

    const content = response.choices[0]?.message?.content;

    if (!content) {
        throw new Error('OpenAI Vision returned empty response');
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
        tokenCount: response.usage?.total_tokens ?? 0,
    };
}
