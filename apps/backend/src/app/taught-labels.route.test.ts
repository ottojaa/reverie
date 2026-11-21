import sensible from '@fastify/sensible';
import {
    TaughtLabelDetailResponseSchema,
    TaughtLabelListResponseSchema,
    TaughtLabelSchema,
    TaughtLabelSimilaritiesResponseSchema,
    TeachLabelResponseSchema,
} from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));

import { toVectorLiteral } from '../embeddings/embedding.repository';
import { IMAGE_DIMENSIONS, IMAGE_MODEL, leaning } from '../testing/fake-ml.js';
import { seedDocument, seedFolder, seedUser } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import taughtLabelsRoute from './routes/taught-labels.route.js';

describeDb('/taught-labels', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let owner: string;

    const world = (): World => ctx.world();
    const token = (userId: string) => app.jwt.sign({ sub: userId, email: 'x@example.test' } as never);

    async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, userId = owner) {
        const response = await app.inject({ method, url, payload, headers: { authorization: 'Bearer ' + token(userId) } });

        return { status: response.statusCode, raw: response.body, json: () => JSON.parse(response.body) as unknown };
    }

    async function image(cosine: number, opts: { folderId?: string | null; userId?: string } = {}) {
        const id = await seedDocument(world().db, {
            userId: opts.userId ?? owner,
            name: 'route-' + Math.random().toString(36).slice(2) + '.jpg',
            mime: 'image/jpeg',
            folderId: opts.folderId ?? null,
        });

        await world()
            .db.insertInto('document_image_embeddings')
            .values({
                document_id: id,
                content_hash: 'h',
                model: IMAGE_MODEL.name,
                model_version: IMAGE_MODEL.revision,
                embedding: toVectorLiteral(leaning(IMAGE_DIMENSIONS, 0, cosine)),
            })
            .execute();

        return id;
    }

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(taughtLabelsRoute);
        await app.ready();
        owner = await seedUser(world().db, 'route-owner');
    }, 60_000);
    afterAll(() => app.close());

    it('requires a signed-in user', async () => {
        expect((await app.inject({ method: 'GET', url: '/taught-labels' })).statusCode).toBe(401);
    });

    it('teaches a label, lists it, shows its detail and the similarities, in the shapes the web client parses', async () => {
        const [a, near, mid] = [await image(1), await image(0.96), await image(0.8)];

        await image(0.3);
        const taught = await call('POST', '/taught-labels', { name: 'Route Label', document_ids: [a] });
        const { label, added } = TeachLabelResponseSchema.parse(taught.json());

        expect(taught.status).toBe(200);
        expect(added).toBe(1);
        expect(label).toMatchObject({ name: 'route label', threshold: 0.85, threshold_is_custom: false, example_count: 1, match_count: 1 });

        expect(TaughtLabelListResponseSchema.parse((await call('GET', '/taught-labels')).json()).labels.map((l) => l.id)).toEqual([label.id]);

        const detail = TaughtLabelDetailResponseSchema.parse((await call('GET', '/taught-labels/' + label.id)).json());

        expect(detail.examples.map((d) => d.document_id)).toEqual([a]);
        expect(detail.matches.map((d) => d.document_id)).toEqual([near]);
        expect(detail.matches[0]?.taught_tags).toEqual(['route label']);

        const similarities = TaughtLabelSimilaritiesResponseSchema.parse((await call('GET', `/taught-labels/${label.id}/similarities`)).json());

        expect(similarities.similarities).toHaveLength(2);

        const patched = await call('PATCH', '/taught-labels/' + label.id, { threshold: 0.7 });

        expect(TaughtLabelSchema.parse(patched.json())).toMatchObject({ threshold: 0.7, threshold_is_custom: true, match_count: 2 });

        expect((await call('DELETE', `/taught-labels/${label.id}/matches/${mid}`)).status).toBe(204);
        expect((await call('DELETE', `/taught-labels/${label.id}/examples/${a}`)).status).toBe(204);
        expect((await call('DELETE', '/taught-labels/' + label.id)).status).toBe(204);
        expect(TaughtLabelListResponseSchema.parse((await call('GET', '/taught-labels')).json()).labels).toEqual([]);
    });

    it('refuses to teach from a private image in a locked folder, and hides other users’ labels', async () => {
        const vault = await seedFolder(world().db, owner, 'Route vault', { isPrivate: true });
        const inVault = await image(1, { folderId: vault.id });
        const refused = await call('POST', '/taught-labels', { name: 'secret', document_ids: [inVault] });

        expect(refused.status).toBeGreaterThanOrEqual(400);
        expect(refused.raw).not.toContain('Route vault');

        const created = TeachLabelResponseSchema.parse((await call('POST', '/taught-labels', { name: 'mine', document_ids: [await image(1)] })).json());
        const bob = world().bob;

        expect(TaughtLabelListResponseSchema.parse((await call('GET', '/taught-labels', undefined, bob)).json()).labels).toEqual([]);
        expect((await call('GET', '/taught-labels/' + created.label.id, undefined, bob)).status).toBe(404);
        expect((await call('DELETE', '/taught-labels/' + created.label.id, undefined, bob)).status).toBe(404);
    });

    it('rejects a selection with no image and a threshold out of range', async () => {
        const pdf = await seedDocument(world().db, { userId: owner, name: 'x.pdf' });

        expect((await call('POST', '/taught-labels', { name: 'none', document_ids: [pdf] })).status).toBe(400);

        const created = TeachLabelResponseSchema.parse((await call('POST', '/taught-labels', { name: 'range', document_ids: [await image(1)] })).json());

        expect((await call('PATCH', '/taught-labels/' + created.label.id, { threshold: 0.2 })).status).toBe(400);
    });
});
