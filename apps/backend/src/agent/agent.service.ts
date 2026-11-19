import {
    applyAgentEvent,
    ConflictError,
    NotFoundError,
    settleAgentItems,
    type AgentChatDetail,
    type AgentErrorCode,
    type AgentEvent,
    type AgentItem,
    type AgentUndoResponse,
} from '@reverie/shared';
import { createApiToken, revokeAgentToken } from '../services/api-token.service.js';
import { callTool } from '../tools/registry.js';
import { sendToUser } from '../websocket/index.js';
import {
    createChat,
    deleteChat,
    findChat,
    insertMessage,
    listMessages,
    loadUndoneAuditIds,
    toChatDto,
    toChatTitle,
    toMessageDto,
    touchChat,
} from './agent-chats.js';
import { AgentUnavailableError, streamAgentRun } from './agent-client.js';
import { createStreamParser, type AgentEventBody } from './claude-stream.js';

/**
 * Runs the in-app agent. Reverie runs no agent loop: it hands the prompt to the reverie-agent container
 * (stock Claude Code), relays what comes back to the admin's browser over Socket.io, and keeps a copy of
 * the conversation. Claude reaches the library only through /mcp, with a token minted for this one run.
 */

/** Longer than the wrapper's own 15 minute kill, so the token never expires under a live run. */
const RUN_TOKEN_TTL_MS = 20 * 60_000;
const SOCKET_EVENT = 'agent:event';
const STALE_SESSION = /no conversation found/i;

/** One live run per chat. Single backend process, so memory is the right place for it. */
const runs = new Map<string, AbortController>();

interface Failure {
    code: AgentErrorCode;
    message: string;
}

interface RunOutcome {
    items: AgentItem[];
    sessionId: string | null;
    failure: Failure | null;
}

export function isRunning(chatId: string): boolean {
    return runs.has(chatId);
}

/** Records the user's message and starts the run in the background; the answer arrives over the socket. */
export async function sendMessage(userId: string, input: { chatId?: string; prompt: string }): Promise<{ chatId: string }> {
    const existing = input.chatId ? await findChat(userId, input.chatId) : undefined;

    if (input.chatId && !existing) throw new NotFoundError('Agent chat', input.chatId);

    if (existing && isRunning(existing.id)) throw new ConflictError('The agent is still working on this chat');

    const chat = existing ?? (await createChat(userId, toChatTitle(input.prompt)));
    // Registered before the first await below, so a second send cannot slip in while the run is starting.
    const controller = new AbortController();

    runs.set(chat.id, controller);

    try {
        await insertMessage(chat.id, 'user', [{ type: 'text', text: input.prompt }], null);
    } catch (error) {
        runs.delete(chat.id);
        throw error;
    }

    void runAgent(userId, chat.id, chat.claude_session_id, input.prompt, controller);

    return { chatId: chat.id };
}

export async function stopRun(userId: string, chatId: string): Promise<void> {
    if (!(await findChat(userId, chatId))) throw new NotFoundError('Agent chat', chatId);

    runs.get(chatId)?.abort();
}

async function runAgent(userId: string, chatId: string, sessionIn: string | null, prompt: string, controller: AbortController): Promise<void> {
    const emit = (body: AgentEventBody) => sendToUser(userId, SOCKET_EVENT, { ...body, chat_id: chatId } satisfies AgentEvent);
    const parser = createStreamParser();
    const outcome: RunOutcome = { items: [], sessionId: sessionIn, failure: null };
    let tokenId: string | null = null;

    emit({ type: 'run_started' });

    try {
        const { token, secret } = await createApiToken(userId, 'In-app agent', { kind: 'agent', expiresAt: new Date(Date.now() + RUN_TOKEN_TTL_MS) });

        tokenId = token.id;

        for await (const line of streamAgentRun({ prompt, sessionId: sessionIn, mcpToken: secret }, controller.signal)) {
            for (const signal of parser.push(line)) {
                if (signal.kind === 'session') outcome.sessionId = signal.sessionId;
                else if (signal.kind === 'failure') outcome.failure ??= { code: signal.code, message: signal.message };
                else {
                    outcome.items = applyAgentEvent(outcome.items, { ...signal.event, chat_id: chatId });
                    emit(signal.event);
                }
            }
        }
    } catch (error) {
        if (!controller.signal.aborted) outcome.failure ??= toFailure(error);
    } finally {
        if (tokenId) await revokeAgentToken(tokenId).catch((error) => console.error('Failed to revoke agent token', error));
    }

    // A stale session means the agent's volume lost it: forget it so the next message starts fresh.
    if (outcome.failure && STALE_SESSION.test(outcome.failure.message)) outcome.sessionId = null;

    await saveRun(chatId, { ...outcome, items: settleAgentItems(outcome.items) });
    runs.delete(chatId);
    emit({ type: 'run_finished', error: outcome.failure });
}

function toFailure(error: unknown): Failure {
    if (error instanceof AgentUnavailableError) return { code: 'unavailable', message: error.message };

    console.error('Agent run failed', error);

    return { code: 'failed', message: 'The agent run failed' };
}

async function saveRun(chatId: string, outcome: RunOutcome): Promise<void> {
    try {
        // The chat may have been deleted while the run was going (deleting aborts it): then there is nothing to save to.
        if (!(await touchChat(chatId, outcome.sessionId))) return;

        if (outcome.items.length > 0 || outcome.failure) await insertMessage(chatId, 'assistant', outcome.items, outcome.failure?.message ?? null);
    } catch (error) {
        console.error('Failed to save agent run', { chatId, error });
    }
}

/** A chat with its messages; write tool calls carry whether they have since been undone. */
export async function loadChatDetail(userId: string, chatId: string): Promise<AgentChatDetail> {
    const chat = await findChat(userId, chatId);

    if (!chat) throw new NotFoundError('Agent chat', chatId);

    const messages = (await listMessages(chatId)).map(toMessageDto);
    const auditIds = messages.flatMap((message) => message.items.flatMap((item) => (item.type === 'tool' && item.audit_id ? [item.audit_id] : [])));
    const undone = await loadUndoneAuditIds(userId, auditIds);

    return {
        chat: toChatDto(chat),
        running: isRunning(chatId),
        messages: messages.map((message) => ({
            ...message,
            items: message.items.map((item) => (item.type === 'tool' && item.audit_id ? { ...item, undone: undone.has(item.audit_id) } : item)),
        })),
    };
}

export async function removeChat(userId: string, chatId: string): Promise<void> {
    runs.get(chatId)?.abort();

    if (!(await deleteChat(userId, chatId))) throw new NotFoundError('Agent chat', chatId);
}

/** The registry's own undo, as the admin: the same call Claude would make with undo_write. */
export async function undoWrite(userId: string, auditId: string): Promise<AgentUndoResponse> {
    const result = await callTool('undo_write', { audit_id: auditId, dry_run: false }, { user: { id: userId } });

    return { ok: result.ok, output: result.output };
}
