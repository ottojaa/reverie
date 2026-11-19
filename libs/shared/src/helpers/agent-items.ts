import type { AgentEvent, AgentItem } from '../api/schemas/agent.js';

/**
 * Folds one live agent event into a message's items. The backend uses it to build the message it stores and
 * the web uses it to render the draft while streaming, so both always agree on what a run produced.
 * Returns new arrays; the input is never mutated.
 */
export function applyAgentEvent(items: readonly AgentItem[], event: AgentEvent): AgentItem[] {
    if (event.type === 'text_delta') return appendText(items, event.text);

    if (event.type === 'tool_use') {
        if (items.some((item) => item.type === 'tool' && item.id === event.id)) return [...items];

        return [...items, { type: 'tool', id: event.id, name: event.name, input: event.input, status: 'running' }];
    }

    if (event.type === 'tool_result') {
        return items.map((item) => {
            if (item.type !== 'tool' || item.id !== event.id) return item;

            return {
                ...item,
                status: event.ok ? 'done' : 'error',
                output: event.output,
                audit_id: event.audit_id,
                applied: event.applied,
            };
        });
    }

    return [...items];
}

function appendText(items: readonly AgentItem[], text: string): AgentItem[] {
    const last = items[items.length - 1];

    if (last?.type !== 'text') return [...items, { type: 'text', text }];

    return [...items.slice(0, -1), { type: 'text', text: last.text + text }];
}

/** A tool that never got a result (the run died or was stopped) must not show as running forever. */
export function settleAgentItems(items: readonly AgentItem[]): AgentItem[] {
    return items.map((item) => (item.type === 'tool' && item.status === 'running' ? { ...item, status: 'error' } : item));
}
