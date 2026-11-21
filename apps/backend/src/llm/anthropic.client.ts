/**
 * Anthropic (Claude) client and the helpers its calls share: the SDK singleton, effort rules, usage and the cost log line.
 * The calls themselves are in anthropic.provider.ts.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { estimateCostUsd } from './llm-cost';
import type { LlmCallUsage, LlmEffort } from './provider';

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

export function totalTokens(usage: Anthropic.Usage): number {
    return usage.input_tokens + usage.output_tokens;
}

/**
 * Room for adaptive thinking on top of the output budget: thinking counts toward
 * max_tokens, and the Haiku 5.x tokenizer produces ~30% more tokens for the same
 * text. Added here, not in env, so an older .env that pins LLM_MAX_OUTPUT_TOKENS
 * still leaves room.
 */
export const THINKING_HEADROOM_TOKENS = 8000;

/** Models that predate effort and reject `output_config.effort` with a 400. */
const EFFORT_UNSUPPORTED = /^claude-(haiku-[34]|3-)/;

/** Newer models think by default and take `effort`; Haiku 4.5 and older reject it. */
export function isEffortCapable(model: string): boolean {
    return !EFFORT_UNSUPPORTED.test(model);
}

export function toCallUsage(model: string, message: Anthropic.Message): LlmCallUsage {
    return { model, usage: message.usage, stopReason: message.stop_reason, costUsd: estimateCostUsd(model, message.usage) };
}

/**
 * One info line per call: model, effort, tokens and cost. Not gated on NODE_ENV,
 * so production logs carry the per-document spend.
 */
export function logCallCost(kind: string, call: LlmCallUsage, effort: LlmEffort | undefined): void {
    console.info(
        '[Anthropic] ' + kind + ' cost',
        JSON.stringify({
            model: call.model,
            effort: effort ?? null,
            inputTokens: call.usage?.input_tokens ?? null,
            outputTokens: call.usage?.output_tokens ?? null,
            stopReason: call.stopReason,
            costUsd: call.costUsd,
        }),
    );
}
