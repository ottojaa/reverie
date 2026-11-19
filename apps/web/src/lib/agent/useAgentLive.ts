import { toast } from 'sonner';
import type { AgentChatDetail, AgentEvent, AgentItem, AgentMessage, AgentUndoResponse } from '@reverie/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { produce } from 'immer';
import { useEffect } from 'react';
import { AGENT_CHATS_KEY, AGENT_STATUS_KEY, agentApi, agentChatKey, invalidateLibraryQueries } from '../api/agent';
import { connectSocket, onAgentEvents } from '../socket';
import { applyDraftEvent, clearAllDrafts, clearDraft, getDraft, markDraftUndone } from './live-store';

const DRAFT_MESSAGE_PREFIX = 'draft-';

/** True when the run changed the library, so lists elsewhere in the app are stale. */
function hasAppliedWrite(items: AgentItem[]): boolean {
    return items.some((item) => item.type === 'tool' && item.applied === true);
}

/**
 * Puts the finished run into the chat's cached messages in the same tick the draft is dropped, so the
 * reply never blinks out or shows twice. The refetch right after replaces it with the stored copy.
 */
function commitFinishedRun(queryClient: QueryClient, chatId: string, items: AgentItem[], error: string | null): void {
    const message: AgentMessage = { id: DRAFT_MESSAGE_PREFIX + crypto.randomUUID(), role: 'assistant', items, error, created_at: new Date().toISOString() };

    if (items.length > 0 || error) {
        queryClient.setQueryData<AgentChatDetail>(agentChatKey(chatId), (detail) =>
            detail ? { ...detail, running: false, messages: [...detail.messages, message] } : detail,
        );
    }

    clearDraft(chatId);
}

function handleFinished(queryClient: QueryClient, event: Extract<AgentEvent, { type: 'run_finished' }>): void {
    const items = getDraft(event.chat_id)?.items ?? [];

    commitFinishedRun(queryClient, event.chat_id, items, event.error?.message ?? null);
    queryClient.invalidateQueries({ queryKey: agentChatKey(event.chat_id) });
    queryClient.invalidateQueries({ queryKey: AGENT_CHATS_KEY });

    // The agent may have lost (or never had) its login while we thought it was fine.
    if (event.error && event.error.code !== 'failed') queryClient.invalidateQueries({ queryKey: AGENT_STATUS_KEY });

    if (hasAppliedWrite(items)) invalidateLibraryQueries(queryClient);
}

/**
 * Connects the socket and feeds the agent's events into the live draft store and the query cache.
 * The listener is attached before the page can POST a message: a fast run would otherwise finish before it
 * was listening. The server's `running` flag stays the source of truth, so a reload mid-run still works.
 */
export function useAgentLive(): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        clearAllDrafts();
        connectSocket();

        const stop = onAgentEvents(
            (event) => {
                if (event.type === 'run_finished') handleFinished(queryClient, event);
                else applyDraftEvent(event);
            },
            // Events sent while we were offline are gone: reload every chat from the server.
            () => {
                clearAllDrafts();
                queryClient.invalidateQueries({ queryKey: ['agent'] });
            },
        );

        return () => {
            stop();
            clearAllDrafts();
        };
    }, [queryClient]);
}

/** Marks every write with this audit id as undone, in the cached chats. */
function markUndoneInCache(queryClient: QueryClient, auditId: string): void {
    queryClient.setQueriesData<AgentChatDetail>({ queryKey: ['agent', 'chat'] }, (detail) =>
        detail
            ? produce(detail, (draft) => {
                  for (const message of draft.messages) {
                      for (const item of message.items) if (item.type === 'tool' && item.audit_id === auditId) item.undone = true;
                  }
              })
            : detail,
    );
}

function toUndoFailure(result: AgentUndoResponse): string {
    const output = result.output;

    if (typeof output === 'string') return output;

    if (output && typeof output === 'object' && 'error' in output && typeof output.error === 'string') return output.error;

    return 'The change could not be undone';
}

export function useUndoAgentWrite() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (auditId: string) => agentApi.undo(auditId),
        onSuccess: (result, auditId) => {
            if (!result.ok) return void toast.error(toUndoFailure(result));

            markUndoneInCache(queryClient, auditId);
            markDraftUndone(auditId);
            invalidateLibraryQueries(queryClient);
            toast.success('Change undone');
        },
        onError: () => toast.error('The change could not be undone'),
    });
}
