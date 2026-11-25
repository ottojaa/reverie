import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { seedFolder } from '../testing/seed';
import { describeDb, useWorld } from '../testing/tool-world';
import { getPrivateFolderIds, isDocumentPrivate, loadLockMap } from './privacy';

const ctx = useWorld();

describeDb('loadLockMap', () => {
    it('makes a private top folder one lock for everything beneath it, at any depth', async () => {
        const { alice, folders } = ctx.world();
        const map = await loadLockMap(alice);

        for (const folder of [folders.vault, folders.vaultMiddle, folders.vaultInner]) expect(map.get(folder.id)).toBe(folders.vault.id);
    });

    it('makes a private folder three levels down its own lock, leaving the folders above it public', async () => {
        const { alice, folders } = ctx.world();
        const map = await loadLockMap(alice);

        expect(map.get(folders.lockedFolder.id)).toBe(folders.lockedFolder.id);
        expect(map.has(folders.secretParent.id)).toBe(false);
        expect(map.has(folders.secretMiddle.id)).toBe(false);
    });

    it('leaves public folders out, and never reaches another user’s folders', async () => {
        const { alice, bob, folders } = ctx.world();

        expect(await getPrivateFolderIds(alice)).not.toContain(folders.work.id);
        expect(await getPrivateFolderIds(bob)).toEqual([]);
    });

    it('keeps the outermost lock for a folder flagged itself deep beneath a private one', async () => {
        const { alice, folders } = ctx.world();
        const flagged = await seedFolder(ctx.world().db, alice, 'Flagged', { parent: folders.vaultInner, isPrivate: true });
        const beneath = await seedFolder(ctx.world().db, alice, 'Beneath', { parent: flagged });
        const map = await loadLockMap(alice);

        expect(map.get(flagged.id)).toBe(folders.vault.id);
        expect(map.get(beneath.id)).toBe(folders.vault.id);
    });

    it('stays locked beneath a private folder that is in the trash', async () => {
        const { alice, folders } = ctx.world();
        const binned = await seedFolder(ctx.world().db, alice, 'Binned', { isPrivate: true, deleted: true });
        const inside = await seedFolder(ctx.world().db, alice, 'Inside', { parent: binned, deleted: true });

        expect((await loadLockMap(alice)).get(inside.id)).toBe(binned.id);
        expect((await loadLockMap(alice)).has(folders.bin.id)).toBe(false);
    });
});

describeDb('isDocumentPrivate', () => {
    it('is true exactly for documents in or beneath a private folder', async () => {
        const { alice, folders } = ctx.world();

        for (const folder of [folders.lockedFolder, folders.vaultInner]) {
            expect(await isDocumentPrivate({ user_id: alice, folder_id: folder.id })).toBe(true);
        }

        for (const folder of [folders.work, folders.secretMiddle]) {
            expect(await isDocumentPrivate({ user_id: alice, folder_id: folder.id })).toBe(false);
        }

        expect(await isDocumentPrivate({ user_id: alice, folder_id: null })).toBe(false);
    });
});
