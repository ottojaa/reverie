import { applyAgentEvent, type AgentEvent, type AgentItem } from '@reverie/shared';
import { produce } from 'immer';
import { useSyncExternalStore } from 'react';

/**
 * Live, not-yet-stored assistant output, per chat. It lives outside React so the socket listener can write
 * it synchronously and the page can come and go without losing the run in progress.
 */

export interface Draft {
    items: AgentItem[];
}

type Drafts = Readonly<Record<string, Draft>>;

let drafts: Drafts = {};
const listeners = new Set<() => void>();

function setDrafts(next: Drafts): void {
    drafts = next;

    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

export function useDrafts(): Drafts {
    return useSyncExternalStore(subscribe, () => drafts);
}

export function getDraft(chatId: string): Draft | undefined {
    return drafts[chatId];
}

/** Folds a streaming event into the chat's draft. `run_finished` is handled by the caller, which owns the cache. */
export function applyDraftEvent(event: AgentEvent): void {
    if (event.type === 'run_finished') return;

    setDrafts(
        produce(drafts, (draft) => {
            const current = event.type === 'run_started' ? [] : (drafts[event.chat_id]?.items ?? []);

            draft[event.chat_id] = { items: applyAgentEvent(current, event) };
        }),
    );
}

export function markDraftUndone(auditId: string): void {
    setDrafts(
        produce(drafts, (draft) => {
            for (const entry of Object.values(draft)) {
                for (const item of entry.items) if (item.type === 'tool' && item.audit_id === auditId) item.undone = true;
            }
        }),
    );
}

export function clearDraft(chatId: string): void {
    if (!(chatId in drafts)) return;

    setDrafts(
        produce(drafts, (draft) => {
            delete draft[chatId];
        }),
    );
}

export function clearAllDrafts(): void {
    setDrafts({});
}
