/**
 * Organize Conversation Store
 *
 * The Anthropic Messages API is stateless — unlike OpenAI's Responses API
 * (previous_response_id), there is no server-side conversation state. To keep
 * the existing wire contract (an opaque `response_id` the web client round-trips
 * across turns), we persist the conversation here, keyed by a generated id.
 *
 * We store:
 * - `messages`: the full Anthropic message history, resent on each follow-up turn.
 * - `groups`: a map of the short group_ids handed to the model by find_documents
 *   to the resolved document ids. This is how propose_organization resolves a
 *   group_id back to documents without the model ever echoing UUIDs.
 *
 * Entries expire after TTL_SECONDS; a stale/expired id simply starts a new
 * conversation (same behaviour as an expired OpenAI response id).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { nanoid } from 'nanoid';
import { getRedisPublisher } from '../queues/redis';

const KEY_PREFIX = 'organize:conv:';
const TTL_SECONDS = 3600; // 1 hour

export interface OrganizeConversationState {
    messages: Anthropic.MessageParam[];
    /** group_id -> resolved document ids, populated by find_documents. */
    groups: Record<string, string[]>;
    /** Monotonic counter for allocating unique group_ids within a conversation. */
    groupCounter: number;
}

export function createConversationId(): string {
    return nanoid();
}

export function newConversationState(): OrganizeConversationState {
    return { messages: [], groups: {}, groupCounter: 0 };
}

export async function loadConversation(conversationId: string): Promise<OrganizeConversationState | null> {
    const raw = await getRedisPublisher().get(KEY_PREFIX + conversationId);

    if (!raw) return null;

    try {
        return JSON.parse(raw) as OrganizeConversationState;
    } catch {
        return null;
    }
}

export async function saveConversation(conversationId: string, state: OrganizeConversationState): Promise<void> {
    await getRedisPublisher().set(KEY_PREFIX + conversationId, JSON.stringify(state), 'EX', TTL_SECONDS);
}
