import {
    AgentChatDetailSchema,
    AgentChatParamsSchema,
    AgentSendMessageRequestSchema,
    AgentSendMessageResponseSchema,
    AgentStatusSchema,
    AgentUndoRequestSchema,
    AgentUndoResponseSchema,
    ListAgentChatsResponseSchema,
    type AgentSendMessageRequest,
    type AgentUndoRequest,
} from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listChats, toChatDto } from '../../agent/agent-chats.js';
import { fetchAgentStatus } from '../../agent/agent-client.js';
import { loadChatDetail, removeChat, sendMessage, stopRun, undoWrite } from '../../agent/agent.service.js';

/**
 * The in-app agent is for the admin only, and that is a licensing line, not just a permissions one: the
 * agent is stock Claude Code signed in with the server owner's own Claude plan, and Anthropic's terms allow
 * that plan to serve its owner, not other people. Reverie assumes the admin is that owner. Do not loosen
 * this gate to other roles without changing how the agent signs in.
 */
export default async function (fastify: FastifyInstance) {
    const preHandler = [fastify.authenticate, fastify.authenticateAdmin];
    const tags = ['Agent'];

    fastify.get(
        '/agent/status',
        { preHandler, schema: { description: 'Whether the agent container is up and signed in (admin only)', tags, response: { 200: AgentStatusSchema } } },
        async () => fetchAgentStatus(),
    );

    fastify.get(
        '/agent/chats',
        { preHandler, schema: { description: "The admin's agent chats, newest first (admin only)", tags, response: { 200: ListAgentChatsResponseSchema } } },
        async (request) => ({ chats: (await listChats(request.user.id)).map(toChatDto) }),
    );

    fastify.get(
        '/agent/chats/:id',
        {
            preHandler,
            schema: { description: 'One chat with its messages (admin only)', tags, params: AgentChatParamsSchema, response: { 200: AgentChatDetailSchema } },
        },
        async (request) => loadChatDetail(request.user.id, (request.params as { id: string }).id),
    );

    fastify.delete(
        '/agent/chats/:id',
        { preHandler, schema: { description: 'Delete a chat (admin only)', tags, params: AgentChatParamsSchema, response: { 204: z.null() } } },
        async (request, reply) => {
            await removeChat(request.user.id, (request.params as { id: string }).id);

            return reply.status(204).send();
        },
    );

    fastify.post(
        '/agent/messages',
        {
            preHandler,
            config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
            schema: {
                description: 'Send a message to the agent; the reply streams over the socket as `agent:event` (admin only)',
                tags,
                body: AgentSendMessageRequestSchema,
                response: { 202: AgentSendMessageResponseSchema },
            },
        },
        async (request, reply) => {
            const { chat_id, prompt } = request.body as AgentSendMessageRequest;
            const { chatId } = await sendMessage(request.user.id, { chatId: chat_id, prompt });

            return reply.status(202).send({ chat_id: chatId });
        },
    );

    fastify.post(
        '/agent/chats/:id/stop',
        { preHandler, schema: { description: "Stop the chat's running agent (admin only)", tags, params: AgentChatParamsSchema, response: { 204: z.null() } } },
        async (request, reply) => {
            await stopRun(request.user.id, (request.params as { id: string }).id);

            return reply.status(204).send();
        },
    );

    fastify.post(
        '/agent/undo',
        {
            preHandler,
            schema: {
                description: "Undo one of the agent's writes through the tool registry (admin only)",
                tags,
                body: AgentUndoRequestSchema,
                response: { 200: AgentUndoResponseSchema },
            },
        },
        async (request) => undoWrite(request.user.id, (request.body as AgentUndoRequest).audit_id),
    );
}
