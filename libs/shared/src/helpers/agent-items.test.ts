import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentItem } from '../api/schemas/agent.js';
import { applyAgentEvent, settleAgentItems } from './agent-items.js';

const chat_id = '11111111-1111-4111-8111-111111111111';

// Omit<> on a union collapses it, so spell out the distribution.
type EventBody<T> = T extends AgentEvent ? Omit<T, 'chat_id'> : never;

function fold(events: EventBody<AgentEvent>[]): AgentItem[] {
    return events.reduce<AgentItem[]>((items, event) => applyAgentEvent(items, { ...event, chat_id } as AgentEvent), []);
}

describe('applyAgentEvent', () => {
    it('joins consecutive text deltas into one text item', () => {
        expect(
            fold([
                { type: 'text_delta', text: 'Hel' },
                { type: 'text_delta', text: 'lo' },
            ]),
        ).toEqual([{ type: 'text', text: 'Hello' }]);
    });

    it('starts a new text item after a tool call', () => {
        const items = fold([
            { type: 'text_delta', text: 'Moving. ' },
            { type: 'tool_use', id: 't1', name: 'move_documents', input: {} },
            { type: 'text_delta', text: 'Done.' },
        ]);

        expect(items.map((item) => item.type)).toEqual(['text', 'tool', 'text']);
    });

    it('fills in a tool call from its result, keeping the audit id of a write', () => {
        const items = fold([
            { type: 'tool_use', id: 't1', name: 'move_documents', input: { dry_run: false } },
            { type: 'tool_result', id: 't1', ok: true, output: { moved: 2 }, audit_id: 'a1', applied: true },
        ]);

        expect(items).toEqual([
            { type: 'tool', id: 't1', name: 'move_documents', input: { dry_run: false }, status: 'done', output: { moved: 2 }, audit_id: 'a1', applied: true },
        ]);
    });

    it('marks a failed result as an error and ignores a repeated tool_use', () => {
        const items = fold([
            { type: 'tool_use', id: 't1', name: 'search', input: {} },
            { type: 'tool_use', id: 't1', name: 'search', input: {} },
            { type: 'tool_result', id: 't1', ok: false, output: { error: 'nope' } },
        ]);

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ status: 'error' });
    });

    it('never changes the items it was given', () => {
        const before: AgentItem[] = [{ type: 'text', text: 'a' }];

        applyAgentEvent(before, { type: 'text_delta', chat_id, text: 'b' });
        expect(before).toEqual([{ type: 'text', text: 'a' }]);
    });
});

describe('settleAgentItems', () => {
    it('turns a tool that never answered into an error', () => {
        const items = settleAgentItems([{ type: 'tool', id: 't', name: 'search', input: {}, status: 'running' }]);

        expect(items[0]).toMatchObject({ status: 'error' });
    });
});
