import {
    AgentChatDetailSchema,
    AgentSendMessageResponseSchema,
    AgentStatusSchema,
    AgentUndoResponseSchema,
    ListAgentChatsResponseSchema,
    type AgentChat,
    type AgentChatDetail,
    type AgentSendMessageRequest,
    type AgentStatus,
    type AgentUndoResponse,
} from '@reverie/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '../auth';
import { apiClient, getApiErrorMessage } from './client';

export const agentApi = {
    async status(): Promise<AgentStatus> {
        const { data } = await apiClient.get('/agent/status');

        return AgentStatusSchema.parse(data);
    },

    async listChats(): Promise<AgentChat[]> {
        const { data } = await apiClient.get('/agent/chats');

        return ListAgentChatsResponseSchema.parse(data).chats;
    },

    async getChat(id: string): Promise<AgentChatDetail> {
        const { data } = await apiClient.get(`/agent/chats/${id}`);

        return AgentChatDetailSchema.parse(data);
    },

    async deleteChat(id: string): Promise<void> {
        await apiClient.delete(`/agent/chats/${id}`);
    },

    async send(request: AgentSendMessageRequest): Promise<string> {
        const { data } = await apiClient.post('/agent/messages', request);

        return AgentSendMessageResponseSchema.parse(data).chat_id;
    },

    async stop(id: string): Promise<void> {
        await apiClient.post(`/agent/chats/${id}/stop`);
    },

    async undo(auditId: string): Promise<AgentUndoResponse> {
        const { data } = await apiClient.post('/agent/undo', { audit_id: auditId });

        return AgentUndoResponseSchema.parse(data);
    },
};

export const AGENT_STATUS_KEY = ['agent', 'status'] as const;
export const AGENT_CHATS_KEY = ['agent', 'chats'] as const;
export const agentChatKey = (id: string) => ['agent', 'chat', id] as const;

/** Queries whose results an agent write can change. */
export function invalidateLibraryQueries(queryClient: ReturnType<typeof useQueryClient>): void {
    for (const key of ['documents', 'search', 'sections']) queryClient.invalidateQueries({ queryKey: [key] });
}

export function useAgentStatus(enabled: boolean) {
    return useQuery({ queryKey: AGENT_STATUS_KEY, queryFn: () => agentApi.status(), enabled, refetchOnWindowFocus: true });
}

export function useAgentChats(enabled: boolean) {
    const { isAuthenticated } = useAuth();

    return useQuery({ queryKey: AGENT_CHATS_KEY, queryFn: () => agentApi.listChats(), enabled: enabled && isAuthenticated });
}

export function useAgentChat(chatId: string | undefined) {
    return useQuery({ queryKey: agentChatKey(chatId ?? ''), queryFn: () => agentApi.getChat(chatId!), enabled: !!chatId });
}

export function useSendAgentMessage() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: AgentSendMessageRequest) => agentApi.send(request),
        onSuccess: (chatId) => {
            queryClient.invalidateQueries({ queryKey: agentChatKey(chatId) });
            queryClient.invalidateQueries({ queryKey: AGENT_CHATS_KEY });
        },
        onError: (error) => toast.error(getApiErrorMessage(error, 'Could not send the message')),
    });
}

export function useStopAgentRun() {
    return useMutation({
        mutationFn: (chatId: string) => agentApi.stop(chatId),
        onError: (error) => toast.error(getApiErrorMessage(error, 'Could not stop the agent')),
    });
}

export function useDeleteAgentChat() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (chatId: string) => agentApi.deleteChat(chatId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: AGENT_CHATS_KEY }),
        onError: (error) => toast.error(getApiErrorMessage(error, 'Could not delete the chat')),
    });
}
