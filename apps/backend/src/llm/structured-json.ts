/**
 * Structured output from a server that has no SDK doing it for us: the JSON Schema to ask for, and a tolerant read of
 * what comes back, checked against the same Zod schema the Anthropic path uses.
 */
import * as z from 'zod/v4';

/** The JSON Schema of a response type, as an OpenAI-style `response_format` or a prompt wants it. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
    const { $schema: _dialect, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;

    return rest;
}

export type ParsedReply<T> = { ok: true; value: T } | { ok: false; error: string };

/** The object inside a reply that may be wrapped in a code fence or prose: from the first `{` to the last `}`. */
function extractJsonText(reply: string): string {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');

    return start === -1 || end < start ? reply : reply.slice(start, end + 1);
}

/** A reply read as JSON and validated. The error is written for the model: it is sent back in the repair request. */
export function parseReply<T>(reply: string, schema: z.ZodType<T>): ParsedReply<T> {
    let json: unknown;

    try {
        json = JSON.parse(extractJsonText(reply));
    } catch {
        return { ok: false, error: 'The reply was not valid JSON.' };
    }

    const parsed = schema.safeParse(json);

    if (parsed.success) return { ok: true, value: parsed.data };

    const problems = parsed.error.issues.slice(0, 8).map((issue) => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message);

    return { ok: false, error: 'The JSON did not match the schema: ' + problems.join('; ') };
}
