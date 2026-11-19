import type { AgentChat, AgentItem, AgentMessage } from '@reverie/shared';
import { db } from '../db/kysely.js';
import type { AgentChatRow, AgentMessageRow } from '../db/schema.js';

/** Persistence for agent chats. Every query is scoped to the owning user. */

const TITLE_LENGTH = 60;

export function toChatTitle(prompt: string): string {
    const oneLine = prompt.replace(/\s+/g, ' ').trim();

    return oneLine.length > TITLE_LENGTH ? oneLine.slice(0, TITLE_LENGTH - 1) + '…' : oneLine;
}

export function toChatDto(row: AgentChatRow): AgentChat {
    return { id: row.id, title: row.title, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() };
}

export function toMessageDto(row: AgentMessageRow): AgentMessage {
    return { id: row.id, role: row.role, items: row.items as AgentItem[], error: row.error, created_at: row.created_at.toISOString() };
}

export async function createChat(userId: string, title: string): Promise<AgentChatRow> {
    return db.insertInto('agent_chats').values({ user_id: userId, title }).returningAll().executeTakeFirstOrThrow();
}

export async function findChat(userId: string, chatId: string): Promise<AgentChatRow | undefined> {
    return db.selectFrom('agent_chats').selectAll().where('id', '=', chatId).where('user_id', '=', userId).executeTakeFirst();
}

export async function listChats(userId: string): Promise<AgentChatRow[]> {
    return db.selectFrom('agent_chats').selectAll().where('user_id', '=', userId).orderBy('updated_at', 'desc').limit(100).execute();
}

export async function listMessages(chatId: string): Promise<AgentMessageRow[]> {
    return db.selectFrom('agent_messages').selectAll().where('chat_id', '=', chatId).orderBy('created_at').execute();
}

export async function insertMessage(chatId: string, role: 'user' | 'assistant', items: AgentItem[], error: string | null): Promise<void> {
    await db
        .insertInto('agent_messages')
        .values({ chat_id: chatId, role, items: JSON.stringify(items), error })
        .execute();
}

/** Bumps the chat to the top of the list and remembers the Claude session to `--resume`. */
export async function touchChat(chatId: string, sessionId: string | null): Promise<void> {
    await db.updateTable('agent_chats').set({ updated_at: new Date(), claude_session_id: sessionId }).where('id', '=', chatId).execute();
}

export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
    const result = await db.deleteFrom('agent_chats').where('id', '=', chatId).where('user_id', '=', userId).executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
}

/** Which of these audit rows have been undone, whoever did it (the chat, Claude Code, another run). */
export async function loadUndoneAuditIds(userId: string, auditIds: string[]): Promise<Set<string>> {
    if (auditIds.length === 0) return new Set();

    const rows = await db
        .selectFrom('tool_audit_log')
        .select('id')
        .where('user_id', '=', userId)
        .where('id', 'in', auditIds)
        .where('undone_at', 'is not', null)
        .execute();

    return new Set(rows.map((row) => row.id));
}
