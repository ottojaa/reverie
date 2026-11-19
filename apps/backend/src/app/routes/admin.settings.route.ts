import { ListServerSettingsResponseSchema, ServerSettingParamsSchema, ServerSettingResponseSchema, UpdateServerSettingRequestSchema } from '@reverie/shared';
import type { FastifyInstance } from 'fastify';
import { listSettings, resetSetting, setSetting } from '../../settings/settings.service.js';

export default async function (fastify: FastifyInstance) {
    const preHandler = [fastify.authenticate, fastify.authenticateAdmin];

    fastify.get(
        '/admin/settings',
        {
            preHandler,
            schema: {
                description: 'List server settings with current value, default and whether overridden (admin only)',
                tags: ['Admin'],
                response: { 200: ListServerSettingsResponseSchema },
            },
        },
        async () => ({ settings: await listSettings() }),
    );

    fastify.put(
        '/admin/settings/:key',
        {
            preHandler,
            schema: {
                description: "Set a server setting; the value is validated by the setting's schema (admin only)",
                tags: ['Admin'],
                params: ServerSettingParamsSchema,
                body: UpdateServerSettingRequestSchema,
                response: { 200: ServerSettingResponseSchema },
            },
        },
        async (request) => {
            const { key } = request.params as { key: string };
            const { value } = request.body as { value: unknown };

            return { setting: await setSetting(key, value, request.user.id) };
        },
    );

    fastify.delete(
        '/admin/settings/:key',
        {
            preHandler,
            schema: {
                description: 'Reset a server setting to its default (admin only)',
                tags: ['Admin'],
                params: ServerSettingParamsSchema,
                response: { 200: ServerSettingResponseSchema },
            },
        },
        async (request) => {
            const { key } = request.params as { key: string };

            return { setting: await resetSetting(key) };
        },
    );
}
