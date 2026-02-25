import {
    CreateUserRequestSchema,
    CreateUserResponseSchema,
    ListUsersResponseSchema,
    UpdateUserRequestSchema,
    UpdateUserResponseSchema,
    UuidSchema,
} from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createUser, deleteUser, listUsers, updateUser } from '../../services/user.service.js';

// Serialize user for API response (exclude sensitive fields)
function serializeUser(user: {
    id: string;
    email: string;
    display_name: string;
    storage_quota_bytes: number;
    storage_used_bytes: number;
    is_active: boolean;
    role: string;
    created_at: Date;
    last_login_at: Date | null;
}) {
    return {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        storage_quota_bytes: Number(user.storage_quota_bytes),
        storage_used_bytes: Number(user.storage_used_bytes),
        is_active: user.is_active,
        role: user.role,
        created_at: user.created_at.toISOString(),
        last_login_at: user.last_login_at?.toISOString() ?? null,
    };
}

export default async function (fastify: FastifyInstance) {
    fastify.get(
        '/admin/users',
        {
            preHandler: [fastify.authenticate, fastify.authenticateAdmin],
            schema: {
                description: 'List all users (admin only)',
                tags: ['Admin'],
                response: { 200: ListUsersResponseSchema },
            },
        },
        async (_request, reply) => {
            const users = await listUsers();

            return reply.send({
                users: users.map((u) =>
                    serializeUser({
                        ...u,
                        created_at: u.created_at,
                        last_login_at: u.last_login_at,
                    }),
                ),
            });
        },
    );

    fastify.patch(
        '/admin/users/:id',
        {
            preHandler: [fastify.authenticate, fastify.authenticateAdmin],
            schema: {
                description: 'Update user (admin only)',
                tags: ['Admin'],
                params: z.object({ id: UuidSchema }),
                body: UpdateUserRequestSchema,
                response: { 200: UpdateUserResponseSchema, 400: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } } },
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                const body = UpdateUserRequestSchema.parse(request.body);
                const user = await updateUser({
                    id,
                    email: body.email,
                    display_name: body.display_name,
                    quota: body.quota,
                });

                return reply.send({ user: serializeUser(user) });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to update user';

                return reply.status(400).send({
                    error: 'update_user_failed',
                    message,
                });
            }
        },
    );

    fastify.delete(
        '/admin/users/:id',
        {
            preHandler: [fastify.authenticate, fastify.authenticateAdmin],
            schema: {
                description: 'Delete user (admin only). Cannot delete self or other admins.',
                tags: ['Admin'],
                params: z.object({ id: UuidSchema }),
                response: {
                    204: z.null(),
                    400: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
                },
            },
        },
        async (request, reply) => {
            try {
                const { id } = request.params as { id: string };
                await deleteUser({ targetUserId: id, callerUserId: request.user.id });

                return reply.status(204).send();
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to delete user';

                return reply.status(400).send({
                    error: 'delete_user_failed',
                    message,
                });
            }
        },
    );

    fastify.post(
        '/admin/users',
        {
            preHandler: [fastify.authenticate, fastify.authenticateAdmin],
            schema: {
                description: 'Create a new user (admin only)',
                tags: ['Admin'],
                body: CreateUserRequestSchema,
                response: {
                    201: CreateUserResponseSchema,
                    400: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
                },
            },
        },
        async (request, reply) => {
            try {
                const body = CreateUserRequestSchema.parse(request.body);
                const result = await createUser({
                    email: body.email,
                    display_name: body.display_name,
                    quota: body.quota,
                    password: body.password,
                });

                return reply.status(201).send({
                    user: serializeUser(result.user),
                    password: result.password,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to create user';

                return reply.status(400).send({
                    error: 'create_user_failed',
                    message,
                });
            }
        },
    );
}
