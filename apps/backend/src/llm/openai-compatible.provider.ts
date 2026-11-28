/**
 * Provider for any server that speaks the OpenAI chat-completions API (Ollama, llama.cpp server, vLLM, LM Studio):
 * plain fetch, no SDK. JSON comes back through `response_format` (a JSON schema where the server takes one, otherwise
 * JSON mode), is validated with the same Zod schema as the Anthropic path, and gets one repair retry.
 */
import * as z from 'zod/v4';
import { env } from '../config/env';
import { NonRetryableJobError } from '../jobs/job.types';
import { oneAtATime } from '../utils/one-at-a-time';
import { LlmAnalysisSchema, LlmImageUnderstandingSchema } from './llm-response.schema';
import type { LlmUsage } from './llm-cost';
import {
    sumUsage,
    toTokenCount,
    type ImageCallResult,
    type JsonCallResult,
    type LlmCallOptions,
    type LlmCallUsage,
    type LlmProvider,
    type PingRequest,
    type PreparedImage,
    type TextCallResult,
} from './provider';
import { parseReply, toJsonSchema } from './structured-json';
import type { LlmPrompt } from './types';

const PING_MAX_TOKENS = 64;
const ERROR_BODY_CHARS = 300;

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | ContentPart[];
}
type JsonMode = 'json_schema' | 'json_object';

const ChatResponseSchema = z.object({
    choices: z
        .array(
            z.object({
                message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
                finish_reason: z.string().nullish(),
            }),
        )
        .min(1),
    usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).partial().nullish(),
});

interface ChatReply {
    text: string;
    refusal: boolean;
    finishReason: string | null;
    usage: LlmUsage | null;
}

class HttpStatusError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

/** Servers that rejected `json_schema`, by base URL and model, so one that cannot take it is asked once. */
const jsonModes = new Map<string, JsonMode>();

/** For tests: forget which servers rejected `json_schema`. */
export function resetJsonModes(): void {
    jsonModes.clear();
}

export interface OpenAiCompatibleConfig {
    baseUrl: string;
    model: string;
    apiKey?: string | undefined;
    timeoutMs: number;
}

export function toOpenAiCompatibleConfig(baseUrl: string, model: string): OpenAiCompatibleConfig {
    return { baseUrl, model, apiKey: env.LOCAL_LLM_API_KEY, timeoutMs: env.LOCAL_LLM_TIMEOUT_MS };
}

/**
 * A local server gets one call at a time, whichever capability or address it is for: it is one machine running the
 * models. A background document's call waits behind every normal one. Test connection does not wait.
 */
function inLocalTurn<T>({ lane }: LlmCallOptions, call: () => Promise<T>): Promise<T> {
    return oneAtATime('local-llm', call, { yields: lane === 'background' });
}

export class OpenAiCompatibleProvider implements LlmProvider {
    constructor(private readonly config: OpenAiCompatibleConfig) {}

    async summarize(prompt: LlmPrompt, options: LlmCallOptions = {}): Promise<TextCallResult> {
        const { value, call } = await this.completeJson('text_summary', prompt, LlmAnalysisSchema, options);

        return { result: value, tokenCount: toTokenCount(call.usage), call };
    }

    async completeJson<T>(kind: string, prompt: LlmPrompt, schema: z.ZodType<T>, options: LlmCallOptions = {}): Promise<JsonCallResult<T>> {
        const model = options.model ?? this.config.model;
        const maxTokens = Math.max(256, Math.min(prompt.maxTokens, env.LLM_MAX_OUTPUT_TOKENS));
        const user: ChatMessage = { role: 'user', content: prompt.user };

        return inLocalTurn(options, () =>
            this.askForJson(
                kind,
                schema,
                { system: prompt.system, user, model, maxTokens },
                (finishReason) => new Error('Local LLM gave no usable answer: ' + (finishReason ?? 'unknown')),
            ),
        );
    }

    async understand(image: PreparedImage, prompt: LlmPrompt, options: LlmCallOptions = {}): Promise<ImageCallResult> {
        const model = options.model ?? this.config.model;
        const maxTokens = Math.max(256, prompt.maxTokens);
        const user: ChatMessage = { role: 'user', content: [{ type: 'text', text: prompt.user }, toImagePart(image)] };
        const { value, call } = await inLocalTurn(options, () =>
            this.askForJson(
                'image_understanding',
                LlmImageUnderstandingSchema,
                { system: prompt.system, user, model, maxTokens },
                (finishReason) => new NonRetryableJobError('Image call gave no usable answer: ' + (finishReason ?? 'unknown')),
            ),
        );

        return { result: value, tokenCount: toTokenCount(call.usage), call };
    }

    async ping({ text, image }: PingRequest): Promise<string> {
        const content: ChatMessage['content'] = image ? [{ type: 'text', text }, toImagePart(image)] : text;
        const reply = await this.chat({ model: this.config.model, messages: [{ role: 'user', content }], max_tokens: PING_MAX_TOKENS });

        return this.redact(reply.text.trim());
    }

    /**
     * Asks for JSON, validates it, and on an invalid answer asks once more with the problems fed back. Still invalid:
     * `toFailure` says what to throw, so a text summary is retried by the queue as before and an image call is not.
     */
    private async askForJson<T>(
        kind: string,
        schema: z.ZodType<T>,
        request: { system: string; user: ChatMessage; model: string; maxTokens: number },
        toFailure: (finishReason: string | null) => Error,
    ): Promise<{ value: T; call: LlmCallUsage }> {
        const jsonSchema = toJsonSchema(schema);
        const messages: ChatMessage[] = [{ role: 'system', content: request.system }, request.user];
        let usage: LlmUsage | null = null;
        let lastFinish: string | null = null;

        for (let attempt = 0; attempt < 2; attempt++) {
            const reply = await this.chatJson(request.model, messages, request.maxTokens, jsonSchema);

            usage = sumUsage(usage, reply.usage);
            lastFinish = reply.finishReason;

            const parsed = reply.refusal ? ({ ok: false, error: 'The model declined to answer.' } as const) : parseReply(reply.text, schema);

            if (parsed.ok) {
                const call = { model: request.model, usage, stopReason: lastFinish, costUsd: null };

                this.logCost(kind, call);

                return { value: parsed.value, call };
            }

            if (reply.refusal || reply.finishReason === 'length') break;

            messages.push(
                { role: 'assistant', content: reply.text },
                { role: 'user', content: parsed.error + ' Reply again with only the corrected JSON object.' },
            );
        }

        this.logCost(kind, { model: request.model, usage, stopReason: lastFinish, costUsd: null });

        throw toFailure(lastFinish);
    }

    /** The chat request for a JSON answer: a JSON schema where the server takes one, JSON mode where it does not. */
    private async chatJson(model: string, messages: ChatMessage[], maxTokens: number, jsonSchema: Record<string, unknown>): Promise<ChatReply> {
        const key = this.config.baseUrl + ' ' + model;

        if ((jsonModes.get(key) ?? 'json_schema') === 'json_schema') {
            try {
                return await this.chat({
                    model,
                    messages,
                    max_tokens: maxTokens,
                    response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: jsonSchema } },
                });
            } catch (error) {
                // Servers word this differently (and some are silent about it): any 400 or 422 on the schema form means JSON mode.
                if (!(error instanceof HttpStatusError) || (error.status !== 400 && error.status !== 422)) throw error;

                jsonModes.set(key, 'json_object');
            }
        }

        const [system, ...rest] = messages;
        const withSchema: ChatMessage = {
            role: 'system',
            content: system!.content + '\n\nReply with a single JSON object that matches this JSON Schema, and nothing else:\n' + JSON.stringify(jsonSchema),
        };

        return this.chat({ model, messages: [withSchema, ...rest], max_tokens: maxTokens, response_format: { type: 'json_object' } });
    }

    private async chat(body: Record<string, unknown>): Promise<ChatReply> {
        const { baseUrl, apiKey, timeoutMs } = this.config;
        const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
        let response: Response;

        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(apiKey && { authorization: 'Bearer ' + apiKey }) },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            if (error instanceof Error && error.name === 'TimeoutError') throw new Error('Local LLM request timed out: ' + timeoutMs + ' ms');

            throw new Error('Local LLM request failed: ' + this.redact(describeFetchError(error)));
        }

        if (!response.ok) {
            const text = await response.text().catch(() => '');

            throw new HttpStatusError(
                'Local LLM request failed: HTTP ' + response.status + ' ' + this.redact(text.slice(0, ERROR_BODY_CHARS)).trim(),
                response.status,
            );
        }

        return this.toReply(await response.json().catch(() => null));
    }

    private toReply(payload: unknown): ChatReply {
        const parsed = ChatResponseSchema.safeParse(payload);

        if (!parsed.success) throw new Error('Local LLM sent an unexpected reply: not a chat completion');

        const choice = parsed.data.choices[0]!;
        const { prompt_tokens, completion_tokens } = parsed.data.usage ?? {};

        return {
            text: choice.message.content ?? '',
            refusal: !!choice.message.refusal || choice.finish_reason === 'content_filter',
            finishReason: choice.finish_reason ?? null,
            usage: prompt_tokens === undefined || completion_tokens === undefined ? null : { input_tokens: prompt_tokens, output_tokens: completion_tokens },
        };
    }

    /** The API key is in the Authorization header: a server that echoes its request, or an error that quotes it, must not carry it into a job failure, the websocket or a log. */
    private redact(text: string): string {
        const { apiKey } = this.config;

        return apiKey ? text.split(apiKey).join('[redacted]') : text;
    }

    private logCost(kind: string, call: LlmCallUsage): void {
        console.info(
            '[LocalLLM] ' + kind + ' cost',
            JSON.stringify({
                model: call.model,
                inputTokens: call.usage?.input_tokens ?? null,
                outputTokens: call.usage?.output_tokens ?? null,
                stopReason: call.stopReason,
                // A local server has no price per token: unknown, not zero.
                costUsd: null,
            }),
        );
    }
}

function toImagePart(image: PreparedImage): ContentPart {
    return { type: 'image_url', image_url: { url: 'data:' + image.mediaType + ';base64,' + image.base64 } };
}

/** fetch hides the useful part (ECONNREFUSED, ENOTFOUND) in `cause`. */
function describeFetchError(error: unknown): string {
    if (!(error instanceof Error)) return 'unknown error';

    const cause = error.cause instanceof Error ? error.cause.message : '';

    return cause ? error.message + ' (' + cause + ')' : error.message;
}
