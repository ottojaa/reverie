import type { AgentErrorCode, AgentEvent } from '@reverie/shared';

/**
 * Turns the NDJSON that `claude -p --output-format stream-json --include-partial-messages` writes into the
 * few things the chat cares about: text, tool calls and their results, the session id and a failure.
 * Lines it does not understand are ignored, so a new Claude Code version adding event types cannot break a run.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A live event before it is bound to a chat. */
export type AgentEventBody = DistributiveOmit<AgentEvent, 'chat_id'>;

export type StreamSignal =
    | { kind: 'event'; event: AgentEventBody }
    | { kind: 'session'; sessionId: string }
    | { kind: 'failure'; code: AgentErrorCode; message: string };

const TOOL_PREFIX = 'mcp__reverie__';
/** Larger tool outputs are stored as a short preview: the chat shows a summary, the library holds the data. */
const MAX_STORED_OUTPUT_CHARS = 16_000;
const PREVIEW_CHARS = 2_000;
const BROKEN_MCP_STATUSES = new Set(['failed', 'needs-auth', 'disabled']);

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBlocks(message: unknown): Json[] {
    if (!isJson(message) || !Array.isArray(message.content)) return [];

    return message.content.filter(isJson);
}

function toToolName(name: unknown): string {
    const text = typeof name === 'string' ? name : 'unknown';

    return text.startsWith(TOOL_PREFIX) ? text.slice(TOOL_PREFIX.length) : text;
}

/** The text of a tool_result block, parsed as JSON when it is JSON (the registry's tools always are). */
function toToolOutput(content: unknown): unknown {
    const text = Array.isArray(content)
        ? content
              .filter(isJson)
              .map((block) => (typeof block.text === 'string' ? block.text : ''))
              .join('')
        : typeof content === 'string'
          ? content
          : '';

    if (text.length > MAX_STORED_OUTPUT_CHARS) return { truncated: true, preview: text.slice(0, PREVIEW_CHARS) };

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function toWriteFields(output: unknown): { audit_id?: string; applied?: boolean } {
    if (!isJson(output) || typeof output.audit_id !== 'string') return {};

    return { audit_id: output.audit_id, applied: output.applied === true };
}

function toFailureCode(text: string, error: unknown): AgentErrorCode {
    return error === 'authentication_failed' || /not logged in/i.test(text) ? 'not_signed_in' : 'failed';
}

export interface StreamParser {
    push(line: string): StreamSignal[];
}

export function createStreamParser(): StreamParser {
    // Text normally arrives as deltas; the finished assistant message repeats it and must not be added twice.
    let sawDelta = false;
    let sawResult = false;

    function fromAssistant(line: Json): StreamSignal[] {
        const signals: StreamSignal[] = [];
        const text = toBlocks(line.message)
            .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
            .join('');

        if (line.error) return [{ kind: 'failure', code: toFailureCode(text, line.error), message: text || String(line.error) }];

        if (text && !sawDelta) signals.push({ kind: 'event', event: { type: 'text_delta', text } });

        sawDelta = false;

        for (const block of toBlocks(line.message)) {
            if (block.type !== 'tool_use' || typeof block.id !== 'string') continue;

            const input = isJson(block.input) ? block.input : {};

            signals.push({ kind: 'event', event: { type: 'tool_use', id: block.id, name: toToolName(block.name), input } });
        }

        return signals;
    }

    function fromUser(line: Json): StreamSignal[] {
        return toBlocks(line.message)
            .filter((block) => block.type === 'tool_result' && typeof block.tool_use_id === 'string')
            .map((block): StreamSignal => {
                const output = toToolOutput(block.content);

                return {
                    kind: 'event',
                    event: { type: 'tool_result', id: String(block.tool_use_id), ok: block.is_error !== true, output, ...toWriteFields(output) },
                };
            });
    }

    function fromSystem(line: Json): StreamSignal[] {
        if (line.subtype !== 'init') return [];

        const signals: StreamSignal[] = [];

        if (typeof line.session_id === 'string') signals.push({ kind: 'session', sessionId: line.session_id });

        const servers = Array.isArray(line.mcp_servers) ? line.mcp_servers.filter(isJson) : [];
        const broken = servers.find((server) => server.name === 'reverie' && BROKEN_MCP_STATUSES.has(String(server.status)));

        if (broken) signals.push({ kind: 'failure', code: 'unavailable', message: 'The agent could not reach the library tools: ' + String(broken.status) });

        return signals;
    }

    function fromResult(line: Json): StreamSignal[] {
        sawResult = true;

        const signals: StreamSignal[] = [];

        if (typeof line.session_id === 'string') signals.push({ kind: 'session', sessionId: line.session_id });

        if (line.is_error === true) {
            const text = typeof line.result === 'string' ? line.result : 'The agent run failed';

            signals.push({ kind: 'failure', code: toFailureCode(text, null), message: text });
        }

        return signals;
    }

    function fromWrapperExit(line: Json): StreamSignal[] {
        if (sawResult || line.code === 0) return [];

        const tail = typeof line.stderr === 'string' ? line.stderr.trim() : '';

        return [{ kind: 'failure', code: 'failed', message: tail || 'The agent stopped without an answer' }];
    }

    function fromStreamEvent(line: Json): StreamSignal[] {
        const event = line.event;
        const delta = isJson(event) && isJson(event.delta) ? event.delta : null;

        if (line.parent_tool_use_id || !delta || delta.type !== 'text_delta' || typeof delta.text !== 'string') return [];

        sawDelta = true;

        return [{ kind: 'event', event: { type: 'text_delta', text: delta.text } }];
    }

    return {
        push(raw) {
            let line: unknown;

            try {
                line = JSON.parse(raw);
            } catch {
                return [];
            }

            if (!isJson(line)) return [];

            if (line.type === 'stream_event') return fromStreamEvent(line);

            if (line.type === 'assistant') return fromAssistant(line);

            if (line.type === 'user') return fromUser(line);

            if (line.type === 'system') return fromSystem(line);

            if (line.type === 'result') return fromResult(line);

            if (line.type === 'wrapper_exit') return fromWrapperExit(line);

            return [];
        },
    };
}
