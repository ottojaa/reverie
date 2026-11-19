import { describe, expect, it } from 'vitest';
import { createStreamParser, type StreamSignal } from './claude-stream.js';

/** Lines shaped like `claude -p --output-format stream-json --verbose --include-partial-messages`, with ids and text made up. */
const line = (value: unknown) => JSON.stringify(value);

function parse(lines: string[]): StreamSignal[] {
    const parser = createStreamParser();

    return lines.flatMap((raw) => parser.push(raw));
}

const events = (signals: StreamSignal[]) => signals.flatMap((signal) => (signal.kind === 'event' ? [signal.event] : []));

describe('claude stream parser', () => {
    it('reads the session id from init and the result', () => {
        const signals = parse([
            line({ type: 'system', subtype: 'init', session_id: 'abc', mcp_servers: [{ name: 'reverie', status: 'connected' }] }),
            line({ type: 'result', is_error: false, result: 'ok', session_id: 'abc' }),
        ]);

        expect(signals).toEqual([
            { kind: 'session', sessionId: 'abc' },
            { kind: 'session', sessionId: 'abc' },
        ]);
    });

    it('streams text deltas and does not repeat them when the finished message arrives', () => {
        const delta = (text: string) => line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
        const signals = parse([
            delta('Hel'),
            delta('lo'),
            line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
            line({ type: 'assistant', message: { content: [{ type: 'text', text: 'No deltas for this one' }] } }),
        ]);

        expect(events(signals)).toEqual([
            { type: 'text_delta', text: 'Hel' },
            { type: 'text_delta', text: 'lo' },
            { type: 'text_delta', text: 'No deltas for this one' },
        ]);
    });

    it('ignores text from a sub-agent', () => {
        const signals = parse([line({ type: 'stream_event', parent_tool_use_id: 'x', event: { delta: { type: 'text_delta', text: 'inner' } } })]);

        expect(signals).toEqual([]);
    });

    it('turns a tool call and its result into events, dropping the MCP prefix and exposing the audit id of a write', () => {
        const result = { moved: 1, dry_run: false, applied: true, audit_id: 'audit-1' };
        const signals = parse([
            line({
                type: 'assistant',
                message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__reverie__move_documents', input: { dry_run: false } }] },
            }),
            line({
                type: 'user',
                message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: JSON.stringify(result) }] }] },
            }),
        ]);

        expect(events(signals)).toEqual([
            { type: 'tool_use', id: 'toolu_1', name: 'move_documents', input: { dry_run: false } },
            { type: 'tool_result', id: 'toolu_1', ok: true, output: result, audit_id: 'audit-1', applied: true },
        ]);
    });

    it('marks a failed tool result and leaves a read result without write fields', () => {
        const signals = parse([
            line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'plain text' }] } }),
            line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: [{ type: 'text', text: '{"total":2}' }] }] } }),
        ]);

        expect(events(signals)).toEqual([
            { type: 'tool_result', id: 'a', ok: false, output: 'plain text' },
            { type: 'tool_result', id: 'b', ok: true, output: { total: 2 } },
        ]);
    });

    it('keeps only a preview of a very large result', () => {
        const big = JSON.stringify({ rows: 'x'.repeat(20_000) });
        const [event] = events(parse([line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: big }] } })]));

        expect(event).toMatchObject({ type: 'tool_result', output: { truncated: true } });
    });

    it('recognises a signed-out claude, however the message is worded', () => {
        const signals = parse([
            line({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } }),
            line({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }),
        ]);

        expect(signals.map((signal) => signal.kind === 'failure' && signal.code)).toEqual(['not_signed_in', 'not_signed_in']);
    });

    it('reports a library server that did not connect', () => {
        const signals = parse([line({ type: 'system', subtype: 'init', session_id: 's', mcp_servers: [{ name: 'reverie', status: 'failed' }] })]);

        expect(signals).toContainEqual({ kind: 'failure', code: 'unavailable', message: 'The agent could not reach the library tools: failed' });
    });

    it('reports a non-zero exit with no result as a failure, using the captured stderr', () => {
        expect(parse([line({ type: 'wrapper_exit', code: 1, stderr: 'boom\n' })])).toEqual([{ kind: 'failure', code: 'failed', message: 'boom' }]);
        expect(parse([line({ type: 'result', is_error: false, session_id: 's' }), line({ type: 'wrapper_exit', code: 1, stderr: '' })])).toEqual([
            { kind: 'session', sessionId: 's' },
        ]);
        expect(parse([line({ type: 'wrapper_exit', code: 0, stderr: '' })])).toEqual([]);
    });

    it('skips lines it does not understand', () => {
        expect(parse(['not json', line([1, 2]), line({ type: 'rate_limit_event' }), line({ type: 'system', subtype: 'hook_started' })])).toEqual([]);
    });
});
