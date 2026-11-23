/** A Claude model an admin can pick for a background AI capability. */
export interface ClaudeModelOption {
    /** The Anthropic model id, as sent to the API. */
    id: string;
    /** Friendly name for the picker. */
    label: string;
    /** A few words on the trade-off. */
    hint: string;
}

/**
 * The Claude models the admin settings offer: the latest of each family, cheapest first.
 * Other ids still work (the backend accepts any model string, e.g. `claude-haiku-4-5` as a rollback); they just
 * are not offered.
 */
export const CLAUDE_MODELS: readonly ClaudeModelOption[] = [
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'Fastest and cheapest' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Balanced speed and quality' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'Most capable, highest cost' },
];
