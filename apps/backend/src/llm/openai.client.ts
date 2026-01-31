/**
 * OpenAI Client Wrapper (Plan 06)
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

/**
 * Call OpenAI Chat Completion API for text summarization
 */
export async function callChatCompletion(prompt: LlmPrompt, model?: string): Promise<ChatCompletionResult> {
    const client = getOpenAIClient();

    const response = await client.chat.completions.create({
        model: model || env.OPENAI_MODEL,
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
        ],
        max_tokens: prompt.maxTokens,
        temperature: env.OPENAI_TEMPERATURE,
        response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('OpenAI returned empty response');
    }

    return {
        content,
        tokenCount: response.usage?.total_tokens ?? 0,
        model: response.model,
    };
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
            key_entities: result.key_entities ?? [],
            topics: result.topics ?? [],
            document_type: result.document_type,
            key_values: result.key_values,
            sentiment: result.sentiment,
            additional_dates: result.additional_dates,
        },
        tokenCount: response.tokenCount,
    };
}

/**
 * Call OpenAI Vision API for image description
 */
export async function describeImage(
    imageBase64: string,
    mimeType: string,
    prompt: string
): Promise<{ result: VisionResponse; tokenCount: number }> {
    const client = getOpenAIClient();

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
        max_tokens: 300,
        response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('OpenAI Vision returned empty response');
    }

    const result = parseJsonResponse<VisionResponse>(content);

    // Validate required fields
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
