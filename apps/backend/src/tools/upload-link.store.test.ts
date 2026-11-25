import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeUploadLinkPort } from '../testing/fake-upload-link-port';
import { claimUploadLink, createUploadLink, setUploadLinkPort, UPLOAD_LINK_TTL_SECONDS } from './upload-link.store';

const link = { userId: 'user-1', folderId: 'folder-1' };

afterEach(() => setUploadLinkPort(null));

describe('upload links', () => {
    it('gives a link to exactly one of two concurrent claims, and to nobody afterwards', async () => {
        setUploadLinkPort(createFakeUploadLinkPort());

        const { secret } = await createUploadLink(link);
        const claims = await Promise.all([claimUploadLink(secret), claimUploadLink(secret)]);

        expect(claims.filter(Boolean)).toEqual([link]);
        expect(await claimUploadLink(secret)).toBeNull();
    });

    it('expires after 15 minutes', async () => {
        const port = createFakeUploadLinkPort();

        setUploadLinkPort(port);

        const early = await createUploadLink(link);
        const late = await createUploadLink(link);

        port.advance(UPLOAD_LINK_TTL_SECONDS - 1);
        expect(await claimUploadLink(early.secret)).toEqual(link);
        port.advance(1);
        expect(await claimUploadLink(late.secret)).toBeNull();
        expect(UPLOAD_LINK_TTL_SECONDS).toBe(900);
    });

    it('stores only a hash of the 32-byte secret, and knows no other secret', async () => {
        const port = createFakeUploadLinkPort();

        setUploadLinkPort(port);

        const { secret } = await createUploadLink(link);
        const stored = JSON.stringify([...port.entries]);

        expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
        expect(stored).not.toContain(secret);
        expect([...port.entries.keys()]).toEqual(['upload-link:' + createHash('sha256').update(secret).digest('hex')]);
        expect(await claimUploadLink('not-the-secret')).toBeNull();
    });
});

describe('upload links in Redis', () => {
    afterEach(() => {
        vi.doUnmock('../queues/redis.js');
        vi.resetModules();
    });

    it('sets a 15 minute expiry and claims with GETDEL, so Redis hands a link out once', async () => {
        const set = vi.fn(async () => 'OK');
        const getdel = vi.fn(async () => JSON.stringify({ user_id: 'user-1', folder_id: 'folder-1' }));

        vi.resetModules();
        vi.doMock('../queues/redis.js', () => ({ getRedisPublisher: () => ({ set, getdel }) }));

        const store = await import('./upload-link.store.js');
        const { secret } = await store.createUploadLink(link);

        expect(set).toHaveBeenCalledWith(expect.stringMatching(/^upload-link:[0-9a-f]{64}$/), expect.any(String), 'EX', 900);
        expect(await store.claimUploadLink(secret)).toEqual(link);
        expect(getdel).toHaveBeenCalledTimes(1);
    });
});
