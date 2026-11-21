import sensible from '@fastify/sensible';
import { SimilarImagesResponseSchema } from '@reverie/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({ env: { JWT_SECRET: 's'.repeat(32), JWT_ACCESS_EXPIRES: '15m', NODE_ENV: 'test', TRASH_RETENTION_DAYS: 30 } }));

import { toVectorLiteral } from '../embeddings/embedding.repository';
import { IMAGE_DIMENSIONS, IMAGE_MODEL, leaning } from '../testing/fake-ml.js';
import { seedDocument } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import similarImagesRoute from './routes/similar-images.route.js';

describeDb('GET /documents/:id/similar-images', () => {
    const ctx = useWorld();
    let app: FastifyInstance;

    const world = (): World => ctx.world();
    const token = (userId: string) => app.jwt.sign({ sub: userId, email: 'x@example.test' } as never);

    async function embed(documentId: string, cosine: number) {
        await world()
            .db.insertInto('document_image_embeddings')
            .values({
                document_id: documentId,
                content_hash: 'h',
                model: IMAGE_MODEL.name,
                model_version: IMAGE_MODEL.revision,
                embedding: toVectorLiteral(leaning(IMAGE_DIMENSIONS, 0, cosine)),
            })
            .execute();
    }

    async function get(documentId: string, userId?: string) {
        const response = await app.inject({
            method: 'GET',
            url: `/documents/${documentId}/similar-images`,
            headers: userId ? { authorization: 'Bearer ' + token(userId) } : {},
        });

        return { status: response.statusCode, raw: response.body };
    }

    beforeAll(async () => {
        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        await app.register(similarImagesRoute);
        await app.ready();

        const { docs, folders, alice } = world();
        const inVault = await seedDocument(world().db, { userId: alice, name: 'vault-photo.jpg', mime: 'image/jpeg', folderId: folders.vault.id });

        await embed(docs.photo, 1);
        await embed(docs.captioned, 0.9);
        await embed(docs.gpsOnly, 0.6);
        await embed(inVault, 0.95);
        await embed(docs.inVault, 0.99);
    }, 60_000);
    afterAll(() => app.close());

    it('requires a signed-in user', async () => {
        expect((await get(world().docs.photo)).status).toBe(401);
    });

    it('lists the owner’s visible images nearest first, in the response shape the web client parses', async () => {
        const { docs, alice } = world();
        const { status, raw } = await get(docs.photo, alice);
        const body = SimilarImagesResponseSchema.parse(JSON.parse(raw));

        expect(status).toBe(200);
        expect(body.results.map((hit) => hit.document_id)).toEqual([docs.captioned, docs.gpsOnly]);
        expect(body.total).toBe(2);
        expect(body.results[0]?.relevance).toBeGreaterThan(body.results[1]?.relevance ?? 1);
        expect(raw).not.toContain('vault-photo.jpg');
    });

    it('refuses a source in a locked private folder, without naming it', async () => {
        const { status, raw } = await get(world().docs.inVault, world().alice);

        expect(status).toBeGreaterThanOrEqual(400);
        expect(raw).not.toContain('in-vault.pdf');
    });

    it('refuses another user’s document', async () => {
        const { status } = await get(world().docs.photo, world().bob);

        expect(status).toBeGreaterThanOrEqual(400);
    });

    it('returns an empty list for a document without an image embedding', async () => {
        const { status, raw } = await get(world().docs.screenshot, world().alice);

        expect(status).toBe(200);
        expect(JSON.parse(raw)).toEqual({ total: 0, results: [] });
    });
});
