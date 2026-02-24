import {
    OrganizeExecuteResponseSchema,
    type OrganizeExecuteRequest,
    type OrganizeExecuteResponse,
    type OrganizeOperation,
    type OrganizeProposalEvent,
} from '@reverie/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { API_BASE, apiClient, authenticatedFetch } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
    proposal?: OrganizeProposalEvent;
    statusAction?: string;
}

export interface OrganizeChatState {
    messages: ChatMessage[];
    isStreaming: boolean;
    currentProposal: OrganizeProposalEvent | null;
    responseId: string | undefined;
    error: string | null;
}

// ── SSE Stream Consumer ───────────────────────────────────────────────────────

type SseEventHandler = {
    onStatus: (action: string) => void;
    onDelta: (content: string) => void;
    onProposal: (proposal: OrganizeProposalEvent) => void;
    onDone: (responseId: string) => void;
    onError: (message: string) => void;
};

async function streamOrganizeChat(
    message: string,
    responseId: string | undefined,
    handlers: SseEventHandler,
    signal: AbortSignal,
): Promise<void> {
    const response = await authenticatedFetch(`${API_BASE}/organize/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, response_id: responseId }),
        credentials: 'include',
        signal,
    });

    if (!response.ok || !response.body) {
        const text = await response.text().catch(() => 'Unknown error');
        handlers.onError(text);

        return;
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';

        for (const line of lines) {
            if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
                const rawData = line.slice(6).trim();

                if (!rawData || !currentEvent) continue;

                try {
                    const data = JSON.parse(rawData);

                    switch (currentEvent) {
                        case 'status':
                            handlers.onStatus(data.action);
                            break;
                        case 'delta':
                            handlers.onDelta(data.content);
                            break;
                        case 'proposal':
                            handlers.onProposal(data as OrganizeProposalEvent);
                            break;
                        case 'done':
                            handlers.onDone(data.response_id);
                            break;
                        case 'error':
                            handlers.onError(data.message);
                            break;
                    }
                } catch {
                    // Malformed event data - skip
                }

                currentEvent = '';
            }
        }
    }
}

// ── useOrganizeChat hook ──────────────────────────────────────────────────────

let messageCounter = 0;
const newId = () => `msg_${++messageCounter}_${Date.now()}`;

export function useOrganizeChat() {
    const abortRef = useRef<AbortController | null>(null);

    const [state, setState] = useState<OrganizeChatState>({
        messages: [],
        isStreaming: false,
        currentProposal: null,
        responseId: undefined,
        error: null,
    });

    const sendMessage = useCallback(
        async (text: string) => {
            // Cancel any in-progress stream
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            const userMsg: ChatMessage = { id: newId(), role: 'user', content: text };
            const assistantMsgId = newId();
            const assistantMsg: ChatMessage = { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true };

            setState((prev) => ({
                ...prev,
                messages: [...prev.messages, userMsg, assistantMsg],
                isStreaming: true,
                error: null,
            }));

            try {
                await streamOrganizeChat(
                    text,
                    state.responseId,
                    {
                        onStatus: (action) => {
                            setState((prev) => ({
                                ...prev,
                                messages: prev.messages.map((m) => (m.id === assistantMsgId ? { ...m, statusAction: action } : m)),
                            }));
                        },
                        onDelta: (content) => {
                            setState((prev) => ({
                                ...prev,
                                messages: prev.messages.map((m) =>
                                    m.id === assistantMsgId ? { ...m, content: m.content + content, statusAction: undefined } : m,
                                ),
                            }));
                        },
                        onProposal: (proposal) => {
                            setState((prev) => ({
                                ...prev,
                                currentProposal: proposal,
                                messages: prev.messages.map((m) =>
                                    m.id === assistantMsgId ? { ...m, proposal, content: proposal.summary, statusAction: undefined } : m,
                                ),
                            }));
                        },
                        onDone: (responseId) => {
                            setState((prev) => ({
                                ...prev,
                                isStreaming: false,
                                responseId,
                                messages: prev.messages.map((m) =>
                                    m.id === assistantMsgId ? { ...m, isStreaming: false, statusAction: undefined } : m,
                                ),
                            }));
                        },
                        onError: (message) => {
                            setState((prev) => ({
                                ...prev,
                                isStreaming: false,
                                error: message,
                                messages: prev.messages.map((m) =>
                                    m.id === assistantMsgId
                                        ? {
                                              ...m,
                                              isStreaming: false,
                                              content: prev.messages.find((x) => x.id === assistantMsgId)?.content || '',
                                              statusAction: undefined,
                                          }
                                        : m,
                                ),
                            }));
                        },
                    },
                    controller.signal,
                );
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') return;

                const message = err instanceof Error ? err.message : 'Failed to connect to server';
                setState((prev) => ({
                    ...prev,
                    isStreaming: false,
                    error: message,
                    messages: prev.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, isStreaming: false, statusAction: undefined } : m,
                    ),
                }));
            }
        },
        [state.responseId],
    );

    const clearProposal = useCallback(() => {
        setState((prev) => ({ ...prev, currentProposal: null }));
    }, []);

    const updateProposal = useCallback((proposal: OrganizeProposalEvent | null) => {
        setState((prev) => ({ ...prev, currentProposal: proposal }));
    }, []);

    const reset = useCallback(() => {
        abortRef.current?.abort();
        setState({
            messages: [],
            isStreaming: false,
            currentProposal: null,
            responseId: undefined,
            error: null,
        });
    }, []);

    return { ...state, sendMessage, clearProposal, updateProposal, reset };
}

// ── useExecuteOrganize mutation ───────────────────────────────────────────────

export const organizeApi = {
    async execute(operations: OrganizeOperation[]): Promise<OrganizeExecuteResponse> {
        const body: OrganizeExecuteRequest = { operations };
        const { data } = await apiClient.post('/organize/execute', body);

        return OrganizeExecuteResponseSchema.parse(data);
    },
};

export function useExecuteOrganize() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (operations: OrganizeOperation[]) => organizeApi.execute(operations),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
            queryClient.invalidateQueries({ queryKey: ['sections'] });
        },
    });
}
