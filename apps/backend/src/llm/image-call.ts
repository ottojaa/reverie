/**
 * The one Claude call that sees an image together with its OCR text. Callers have already decided the image may go
 * (see decideImageLook): nothing here checks privacy or whether it is a photo.
 */
import sharp from 'sharp';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '../config/env';
import { NonRetryableJobError } from '../jobs/job.types';
import {
    THINKING_HEADROOM_TOKENS,
    getAnthropicClient,
    isEffortCapable,
    logCallCost,
    toCallUsage,
    totalTokens,
    type LlmCallOptions,
    type LlmCallUsage,
} from './anthropic.client';
import { LlmImageUnderstandingSchema, type LlmImageUnderstanding } from './llm-response.schema';
import type { LlmPrompt } from './types';

/**
 * Longest edge of the image sent. A screenshot or page at this size is still readable by eye, and costs about 1.5k
 * input tokens (a fraction of a cent at Haiku 5.5 prices). Larger sizes add cost for little: the OCR text is sent
 * too and carries the fine print. A 4000 px scan would otherwise cost several times more and upload megabytes.
 */
export const IMAGE_LONG_EDGE_PX = 1568;

const JPEG_QUALITY = 85;

export interface PreparedImage {
    base64: string;
    mediaType: 'image/jpeg';
    width: number;
    height: number;
}

/**
 * Downscales to IMAGE_LONG_EDGE_PX (never up), turns it upright by its EXIF orientation, and re-encodes as JPEG with
 * transparency flattened onto white. Re-encoding drops the EXIF block, so no GPS or camera data leaves with the pixels.
 */
export async function prepareImageForClaude(file: Buffer): Promise<PreparedImage> {
    const { data, info } = await sharp(file, { failOn: 'none' })
        .rotate()
        .resize({ width: IMAGE_LONG_EDGE_PX, height: IMAGE_LONG_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true });

    return { base64: data.toString('base64'), mediaType: 'image/jpeg', width: info.width, height: info.height };
}

export interface ImageCallResult {
    result: LlmImageUnderstanding;
    tokenCount: number;
    call: LlmCallUsage;
}

/**
 * One structured request: the image block, then the text block. A refusal, a cut-off answer or an empty one will
 * not change on a retry, so they end the job (NonRetryableJobError); a network or API error is left to the queue's retries.
 */
export async function understandImage(image: PreparedImage, prompt: LlmPrompt, options: LlmCallOptions = {}): Promise<ImageCallResult> {
    const client = getAnthropicClient();
    const model = options.model ?? env.ANTHROPIC_VISION_MODEL;
    const effort = isEffortCapable(model) ? (options.effort ?? env.ANTHROPIC_SUMMARY_EFFORT) : undefined;
    const outputBudget = Math.max(256, prompt.maxTokens);

    const message = await client.messages.parse({
        model,
        max_tokens: effort ? outputBudget + THINKING_HEADROOM_TOKENS : outputBudget,
        system: prompt.system,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
                    { type: 'text', text: prompt.user },
                ],
            },
        ],
        output_config: { format: zodOutputFormat(LlmImageUnderstandingSchema), ...(effort && { effort }) },
    });
    const call = toCallUsage(model, message);

    logCallCost('image_understanding', call, effort);

    if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens' || !message.parsed_output) {
        throw new NonRetryableJobError('Image call gave no usable answer: ' + (message.stop_reason ?? 'unknown'));
    }

    return { result: message.parsed_output, tokenCount: totalTokens(message.usage), call };
}
