import sensible from '@fastify/sensible';
import { mkdir, rm, writeFile } from 'fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Made before anything imports the storage: the route modules read the root when they load.
const storageRoot = vi.hoisted(() => {
    const fs = process.getBuiltinModule('node:fs');
    const os = process.getBuiltinModule('node:os');
    const path = process.getBuiltinModule('node:path');

    return { path: fs.mkdtempSync(path.join(os.tmpdir(), 'reverie-hls-')) };
});
vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../config/env.js', () => ({
    env: {
        JWT_SECRET: 's'.repeat(32),
        JWT_ACCESS_EXPIRES: '15m',
        NODE_ENV: 'test',
        TRASH_RETENTION_DAYS: 30,
        FILE_URL_SECRET: 'f'.repeat(40),
        FILE_URL_EXPIRES_SECONDS: 3600,
        STORAGE_PROVIDER: 'local',
        STORAGE_LOCAL_ROOT: storageRoot.path,
    },
}));

import { createAuthService } from '../services/auth.service.js';
import { toHlsUrl } from '../storage/hls-token.js';
import { seedDocument } from '../testing/seed.js';
import { describeDb, useWorld, type World } from '../testing/tool-world.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import authRoute from './routes/auth.route.js';
import documentsRoute from './routes/documents.route.js';
import filesRoute from './routes/files.route.js';
import vaultRoute from './routes/vault.route.js';

const PASSWORD = 'correct horse battery staple';
const HASH = 'c'.repeat(64);
const OTHER_HASH = 'd'.repeat(64);
const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480\nv480/index.m3u8\n';
const SEGMENT = Buffer.from('0123456789abcdef');

describeDb('HLS streaming', () => {
    const ctx = useWorld();
    let app: FastifyInstance;
    let cookie = '';

    const world = (): World => ctx.world();
    const token = (userId: string) => app.jwt.sign({ sub: userId, email: 'x@example.test' } as never);
    const get = (url: string, userId = world().alice, headers: Record<string, string> = {}) =>
        app.inject({ method: 'GET', url, headers: { authorization: 'Bearer ' + token(userId), ...(cookie ? { cookie } : {}), ...headers } });

    async function hlsUrlOf(documentId: string, userId?: string): Promise<string | null | undefined> {
        const response = await get('/documents/' + documentId, userId);

        return response.statusCode === 200 ? response.json().hls_url : undefined;
    }

    beforeAll(async () => {
        await mkdir(join(storageRoot.path, 'transcode', HASH, 'v480'), { recursive: true });
        await writeFile(join(storageRoot.path, 'transcode', HASH, 'master.m3u8'), MASTER);
        await writeFile(join(storageRoot.path, 'transcode', HASH, 'v480', 'seg_00000.m4s'), SEGMENT);
        // A set that belongs to someone else's content, next to ours.
        await mkdir(join(storageRoot.path, 'transcode', OTHER_HASH), { recursive: true });
        await writeFile(join(storageRoot.path, 'transcode', OTHER_HASH, 'master.m3u8'), 'other');

        app = Fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        await app.register(sensible);
        await app.register(authPlugin);
        await app.register(errorHandler);
        for (const route of [authRoute, documentsRoute, filesRoute, vaultRoute]) await app.register(route);
        await app.ready();

        const hash = await createAuthService(app).hashPassword(PASSWORD);

        await world().db.updateTable('users').set({ password_hash: hash }).execute();
    }, 60_000);
    afterAll(async () => {
        await app.close();
        await rm(storageRoot.path, { recursive: true, force: true });
    });

    const video = (over: Parameters<typeof seedDocument>[1] extends infer T ? Partial<T> : never) =>
        seedDocument(world().db, { userId: world().alice, name: 'clip.mp4', mime: 'video/mp4', hash: HASH, transcodeStatus: 'complete', ...over });

    describe('the signed master URL', () => {
        it('is issued for the owner’s video once every rendition is encoded', async () => {
            const url = await hlsUrlOf(await video({ folderId: world().folders.work.id }));

            expect(url).toMatch(new RegExp(`^/files/hls/\\d+/[A-Za-z0-9_-]+/${HASH}/master\\.m3u8$`));
        });

        it('is null until the ladder is complete, and for a document that never gets one', async () => {
            for (const transcodeStatus of ['pending', 'processing', 'failed', 'skipped'] as const) {
                expect(await hlsUrlOf(await video({ transcodeStatus })), transcodeStatus).toBeNull();
            }
        });

        it('is never given for a trashed video, another user’s video, or a closed private folder', async () => {
            const { folders, bob } = world();

            expect(await hlsUrlOf(await video({ deleted: true }))).toBeUndefined();
            expect(await hlsUrlOf(await video({}), bob)).toBeUndefined();

            const locked = await video({ folderId: folders.lockedFolder.id });
            const refused = await get('/documents/' + locked);

            expect(refused.statusCode).toBe(403);
            expect(refused.body).not.toContain('hls');
            expect((await get('/documents?folder_id=' + folders.lockedFolder.id)).body).not.toContain('/files/hls/');
        });

        it('is given once the private folder is unlocked, in the detail and the listing', async () => {
            const { folders } = world();
            const id = await video({ folderId: folders.lockedFolder.id, name: 'private-clip.mp4' });
            const unlock = await app.inject({
                method: 'POST',
                url: '/vault/unlock',
                payload: { password: PASSWORD, folder_id: folders.lockedFolder.id },
                headers: { authorization: 'Bearer ' + token(world().alice) },
            });

            expect(unlock.statusCode).toBe(200);
            cookie = (unlock.headers['set-cookie'] as string).split(';')[0]!;

            expect(await hlsUrlOf(id)).toMatch(/^\/files\/hls\//);

            const listing = (await get('/documents?folder_id=' + folders.lockedFolder.id)).json();

            expect(listing.items.find((item: { id: string }) => item.id === id).hls_url).toMatch(/^\/files\/hls\//);
            cookie = '';
        });

        it('is null on a document that is not a video', async () => {
            const id = await seedDocument(world().db, { userId: world().alice, name: 'a.pdf', hash: HASH });

            expect(await hlsUrlOf(id)).toBeNull();
        });
    });

    describe('the dev file route', () => {
        const master = () => toHlsUrl(HASH, 'master.m3u8', 3600);
        // The same token, another file of the set: what a player builds from the master URL and a relative playlist entry.
        const sibling = (rest: string) => master().replace('master.m3u8', rest);
        const fetchUnsigned = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });

        it('needs no login: the token is the credential', async () => {
            const response = await fetchUnsigned(master());

            expect(response.statusCode).toBe(200);
            expect(response.body).toBe(MASTER);
            expect(response.headers['content-type']).toBe('application/vnd.apple.mpegurl');
        });

        it('serves a segment of the set under the master’s token, as video/mp4 and with ranges', async () => {
            const full = await fetchUnsigned(sibling('v480/seg_00000.m4s'));
            const part = await fetchUnsigned(sibling('v480/seg_00000.m4s'), { range: 'bytes=2-5' });

            expect(full.statusCode).toBe(200);
            expect(full.headers['content-type']).toBe('video/mp4');
            expect(full.rawPayload.equals(SEGMENT)).toBe(true);
            expect(part.statusCode).toBe(206);
            expect(part.headers['content-range']).toBe('bytes 2-5/16');
            expect(part.rawPayload.toString()).toBe('2345');
        });

        it('refuses a tampered signature, expiry or content hash with 403', async () => {
            const [, , , exp, sig, key, ...rest] = master().split('/');
            const path = rest.join('/');
            const flipped = sig!.slice(0, -1) + (sig!.endsWith('A') ? 'B' : 'A');

            expect((await fetchUnsigned(`/files/hls/${exp}/${flipped}/${key}/${path}`)).statusCode).toBe(403);
            expect((await fetchUnsigned(`/files/hls/${Number(exp) + 100}/${sig}/${key}/${path}`)).statusCode).toBe(403);
            // A token for one set never opens another.
            expect((await fetchUnsigned(`/files/hls/${exp}/${sig}/${OTHER_HASH}/master.m3u8`)).statusCode).toBe(403);
            expect((await fetchUnsigned(`/files/hls/${exp}/x/${key}/${path}`)).statusCode).toBe(403);
        });

        it('refuses an expired token with 410', async () => {
            const response = await fetchUnsigned(toHlsUrl(HASH, 'master.m3u8', -5));

            expect(response.statusCode).toBe(410);
        });

        it('does not let a valid token reach outside its set', async () => {
            for (const rest of ['..%2f' + OTHER_HASH + '%2fmaster.m3u8', '%2e%2e/%2e%2e/etc/passwd', 'v480/%2e%2e/%2e%2e/' + OTHER_HASH + '/master.m3u8']) {
                const response = await fetchUnsigned(sibling(rest));

                // 404 when the path reaches the HLS route, 403 when the server first collapses the `..` into a path with no token.
                expect([403, 404], rest).toContain(response.statusCode);
                expect(response.body, rest).not.toContain('other');
            }
        });

        it('answers 404 for a file the set does not have', async () => {
            expect((await fetchUnsigned(sibling('v1080/index.m3u8'))).statusCode).toBe(404);
        });

        it('leaves the file URLs on their own signature: an HLS token opens no other path', async () => {
            const [, , , exp, sig] = master().split('/');

            expect((await fetchUnsigned(`/files/transcode/${HASH}/master.m3u8?e=${exp}&s=${sig}`)).statusCode).toBe(403);
        });
    });
});
