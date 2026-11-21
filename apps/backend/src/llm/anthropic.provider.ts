/**
 * The Anthropic (Claude) provider: structured outputs through `messages.parse`, effort and thinking headroom on the
 * models that take them, one log line of tokens and cost per call.
 */
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '../config/env';
import { NonRetryableJobError } from '../jobs/job.types';
import { THINKING_HEADROOM_TOKENS, getAnthropicClient, isEffortCapable, logCallCost, toCallUsage, totalTokens } from './anthropic.client';
import { LlmAnalysisSchema, LlmImageUnderstandingSchema } from './llm-response.schema';
import type { ImageCallResult, LlmCallOptions, LlmProvider, PingRequest, PreparedImage, TextCallResult } from './provider';
import type { LlmPrompt } from './types';

const PING_MAX_TOKENS = 64;

export class AnthropicProvider implements LlmProvider {
    constructor(private readonly model: string) {}

    /**
     * Uses structured outputs: the response is constrained to LlmAnalysisSchema and validated by the SDK
     * (`messages.parse`), so no tolerant text parsing is needed. No sampling parameters are sent (API version
     * 2026-10-21 rejects them). On an unparseable result (or truncation) it retries once with identical params.
     */
    async summarize(prompt: LlmPrompt, options: LlmCallOptions = {}): Promise<TextCallResult> {
        const client = getAnthropicClient();
        const model = options.model ?? this.model;
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
     * One structured request: the image block, then the text block. A refusal, a cut-off answer or an empty one will
     * not change on a retry, so they end the job (NonRetryableJobError); a network or API error is left to the queue's retries.
     */
    async understand(image: PreparedImage, prompt: LlmPrompt, options: LlmCallOptions = {}): Promise<ImageCallResult> {
        const client = getAnthropicClient();
        const model = options.model ?? this.model;
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

    async ping({ text, image }: PingRequest): Promise<string> {
        const message = await getAnthropicClient().messages.create({
            model: this.model,
            max_tokens: PING_MAX_TOKENS,
            messages: [
                {
                    role: 'user',
                    content: image
                        ? [
                              { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
                              { type: 'text', text },
                          ]
                        : text,
                },
            ],
        });

        return message.content
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('')
            .trim();
    }
}
