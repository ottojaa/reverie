import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { seedFolder } from '../testing/seed';
import { describeDb, useWorld } from '../testing/tool-world';
import { getPrivateFolderIds, isDocumentPrivate, loadLockMap } from './privacy';

const ctx = useWorld();

describeDb('loadLockMap', () => {
    it('makes a private collection one lock for itself and its folders', async () => {
        const { alice, folders } = ctx.world();
        const map = await loadLockMap(alice);

        expect(map.get(folders.vault.id)).toBe(folders.vault.id);
        expect(map.get(folders.vaultInner.id)).toBe(folders.vault.id);
    });

    it('makes a private folder in a public collection its own lock', async () => {
        const { alice, folders } = ctx.world();
        const map = await loadLockMap(alice);

        expect(map.get(folders.lockedFolder.id)).toBe(folders.lockedFolder.id);
        expect(map.has(folders.secretParent.id)).toBe(false);
    });

    it('leaves public folders out, and never reaches another user’s folders', async () => {
        const { alice, bob, folders } = ctx.world();

        expect(await getPrivateFolderIds(alice)).not.toContain(folders.work.id);
        expect(await getPrivateFolderIds(bob)).toEqual([]);
    });

    it('moves a folder under a private collection into that lock, even when it is flagged itself', async () => {
        const { alice, folders } = ctx.world();
        const flagged = await seedFolder(ctx.world().db, alice, 'Flagged', { parent: folders.vault, isPrivate: true });

        expect((await loadLockMap(alice)).get(flagged.id)).toBe(folders.vault.id);
    });
});

describeDb('isDocumentPrivate', () => {
    it('is true exactly for documents in a private folder', async () => {
        const { alice, folders } = ctx.world();

        expect(await isDocumentPrivate({ user_id: alice, folder_id: folders.lockedFolder.id })).toBe(true);
        expect(await isDocumentPrivate({ user_id: alice, folder_id: folders.vaultInner.id })).toBe(true);
        expect(await isDocumentPrivate({ user_id: alice, folder_id: folders.work.id })).toBe(false);
        expect(await isDocumentPrivate({ user_id: alice, folder_id: null })).toBe(false);
    });
});
