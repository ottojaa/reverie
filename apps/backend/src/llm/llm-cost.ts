/**
 * Cost estimation for the per-document Anthropic calls, in USD.
 *
 * Pure and table-driven so the per-call log line and the model-comparison
 * harness compute cost the same way. These calls use no prompt caching and stay
 * far below 100K prompt tokens (LLM_MAX_INPUT_CHARS), so only the flat input and
 * output rates are modelled; add the long-prompt rate card and cache multipliers
 * if a caller ever needs them.
 */

export interface LlmUsage {
    input_tokens: number;
    output_tokens: number;
}

/** USD per million tokens. */
interface Rates {
    input: number;
    output: number;
}

/**
 * Model id prefix -> rates. First matching prefix wins, so list a longer prefix before any shorter one it starts with
 * (a future `claude-opus-5` row goes after `claude-opus-5-5`).
 */
const RATES: Array<{ prefix: string; rates: Rates }> = [
    { prefix: 'claude-opus-5-5', rates: { input: 4, output: 20 } },
    { prefix: 'claude-sonnet-5-5', rates: { input: 2, output: 10 } },
    { prefix: 'claude-haiku-5-5', rates: { input: 0.1, output: 0.5 } },
    { prefix: 'claude-haiku-4-5', rates: { input: 1, output: 5 } },
];

/**
 * Estimated cost of one call in USD, or null for a model without a known price
 * (callers log null instead of failing the job).
 */
export function estimateCostUsd(model: string, usage: LlmUsage): number | null {
    const entry = RATES.find((candidate) => model.startsWith(candidate.prefix));

    if (!entry) return null;

    return (usage.input_tokens * entry.rates.input + usage.output_tokens * entry.rates.output) / 1_000_000;
}
