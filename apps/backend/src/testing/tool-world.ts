import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe } from 'vitest';
import type { Database } from '../db/schema';
import { setSelectionPort } from '../tools/selection.store';
import { callTool } from '../tools/registry';
import { dbProxy } from './db-proxy';
import { createFakeSelectionPort } from './fake-selection-port';
import { createTestDatabase } from './test-database';
import { seedDocument, seedFolder, seedUser } from './seed';

/**
 * A small library for the tool tests: two users, ordinary documents, every kind of locked and
 * trashed item, and the photo edge cases. The words PLANTED* sit in text that must never reach a
 * tool's output for a photo; the LOCKED* and TRASHED* words sit in items no tool may reveal.
 */

export interface World {
    db: Kysely<Database>;
    alice: string;
    bob: string;
    folders: Record<'work' | 'invoices' | 'vault' | 'vaultInner' | 'secretParent' | 'lockedFolder' | 'bin' | 'empty' | 'bobs', { id: string; path: string }>;
    docs: Record<
        | 'invoice'
        | 'notes'
        | 'loose'
        | 'inLockedFolder'
        | 'inVault'
        | 'inVaultInner'
        | 'trashed'
        | 'inTrashedFolder'
        | 'photo'
        | 'gpsOnly'
        | 'screenshot'
        | 'emptyExif'
        | 'captioned'
        | 'bobs',
        string
    >;
}

/** The documents a user must never see, whatever they ask. */
export const HIDDEN_DOCS = ['inLockedFolder', 'inVault', 'inVaultInner', 'trashed', 'inTrashedFolder'] as const;

async function seedWorld(db: Kysely<Database>): Promise<World> {
    const alice = await seedUser(db, 'alice');
    const bob = await seedUser(db, 'bob');
    const work = await seedFolder(db, alice, 'Work');
    const invoices = await seedFolder(db, alice, 'Invoices', { parent: work });
    const vault = await seedFolder(db, alice, 'Vault', { isPrivate: true });
    const vaultInner = await seedFolder(db, alice, 'Inner', { parent: vault });
    const secretParent = await seedFolder(db, alice, 'Archive');
    const lockedFolder = await seedFolder(db, alice, 'Hidden', { parent: secretParent, isPrivate: true });
    const bin = await seedFolder(db, alice, 'Bin', { deleted: true });
    const empty = await seedFolder(db, alice, 'Empty');
    const bobs = await seedFolder(db, bob, 'BobWork');
    const day = (iso: string) => new Date(iso + 'T12:00:00Z');
    const docs: World['docs'] = {
        invoice: await seedDocument(db, {
            userId: alice,
            name: 'invoice-acme.pdf',
            folderId: invoices.id,
            category: 'receipt',
            extractedDate: day('2024-03-10'),
            ocrText: 'Invoice total 120 EUR for Acme services',
            summary: 'Invoice from Acme Oy for consulting',
            entities: ['Acme Oy'],
            tags: ['tax', 'acme'],
        }),
        notes: await seedDocument(db, {
            userId: alice,
            name: 'notes.pdf',
            folderId: work.id,
            category: 'other',
            extractedDate: day('2023-06-01'),
            ocrText: 'Meeting notes about the roadmap',
            summary: 'Notes on the roadmap',
        }),
        loose: await seedDocument(db, { userId: alice, name: 'loose.pdf', category: 'other', ocrText: 'A loose page' }),
        inLockedFolder: await seedDocument(db, {
            userId: alice,
            name: 'in-locked-folder.pdf',
            folderId: lockedFolder.id,
            ocrText: 'LOCKEDWORD content',
            tags: ['lockedtag'],
        }),
        inVault: await seedDocument(db, { userId: alice, name: 'in-vault.pdf', folderId: vault.id, ocrText: 'LOCKEDWORD content', tags: ['lockedtag'] }),
        inVaultInner: await seedDocument(db, {
            userId: alice,
            name: 'in-vault-inner.pdf',
            folderId: vaultInner.id,
            ocrText: 'LOCKEDWORD content',
            tags: ['lockedtag'],
        }),
        trashed: await seedDocument(db, { userId: alice, name: 'trashed.pdf', deleted: true, ocrText: 'TRASHEDWORD content', tags: ['trashedtag'] }),
        inTrashedFolder: await seedDocument(db, { userId: alice, name: 'in-bin.pdf', folderId: bin.id, deleted: true, ocrText: 'TRASHEDWORD content' }),
        photo: await seedDocument(db, {
            userId: alice,
            name: 'IMG_0001.jpg',
            mime: 'image/jpeg',
            folderId: work.id,
            category: 'photo',
            extractedDate: day('2020-01-01'),
            ocrText: 'PLANTEDOCR',
            summary: 'A beach at sunset PLANTEDCAPTION',
            entities: ['PLANTEDENTITY'],
            tags: ['holiday'],
            photo: { takenAt: day('2022-07-15'), latitude: 60.17, longitude: 24.94, city: 'Helsinki', country: 'Finland' },
        }),
        gpsOnly: await seedDocument(db, {
            userId: alice,
            name: 'IMG_0002.jpg',
            mime: 'image/jpeg',
            category: 'photo',
            summary: 'A forest PLANTEDCAPTION',
            photo: { latitude: 61.5, longitude: 23.7, city: 'Tampere', country: 'Finland' },
        }),
        screenshot: await seedDocument(db, {
            userId: alice,
            name: 'Screenshot 1.png',
            mime: 'image/png',
            category: 'screenshot',
            extractedDate: day('2024-05-05'),
            ocrText: 'Dashboard SCREENSHOTTEXT',
            summary: 'A dashboard SCREENSHOTTEXT',
            tags: ['ui'],
        }),
        emptyExif: await seedDocument(db, {
            userId: alice,
            name: 'scan.jpg',
            mime: 'image/jpeg',
            category: 'other',
            ocrText: 'SCANTEXT',
            summary: 'A scanned letter SCANTEXT',
            photo: {},
        }),
        captioned: await seedDocument(db, {
            userId: alice,
            name: 'downloaded.jpg',
            mime: 'image/jpeg',
            category: 'photo',
            summary: 'A cat on a sofa CAPTIONWORD',
            ocrText: 'CAPTIONOCR',
        }),
        bobs: await seedDocument(db, { userId: bob, name: 'bob-invoice.pdf', folderId: bobs.id, ocrText: 'BOBWORD content', tags: ['bobtag'] }),
    };

    return { db, alice, bob, docs, folders: { work, invoices, vault, vaultInner, secretParent, lockedFolder, bin, empty, bobs } };
}

/** Start the database, seed the world and point `db/kysely` and the selection store at them. */
export async function startWorld(): Promise<{ world: World; port: ReturnType<typeof createFakeSelectionPort>; close: () => Promise<void> }> {
    const database = await createTestDatabase();

    dbProxy.use(database.db);

    const port = createFakeSelectionPort();

    setSelectionPort(port);

    return { world: await seedWorld(database.db), port, close: database.close };
}

/** Run a tool as `userId` and return its output, throwing the error message when the call is refused. */
export async function run(userId: string, name: string, input: Record<string, unknown> = {}): Promise<any> {
    const result = await callTool(name, input, { user: { id: userId } });

    if (!result.ok) throw new Error((result.output as { error: string }).error);

    return result.output;
}

/** Run a tool and return the refusal message (fails if it succeeded). */
export async function refusal(userId: string, name: string, input: Record<string, unknown> = {}): Promise<string> {
    const result = await callTool(name, input, { user: { id: userId } });

    if (result.ok) throw new Error('Expected ' + name + ' to be refused');

    return (result.output as { error: string }).error;
}

/** `describe` for suites that need Postgres; `SKIP_DB_TESTS=1` turns them off on purpose. */
export function describeDb(name: string, body: () => void): void {
    describe.skipIf(process.env['SKIP_DB_TESTS'] === '1')(name, body);
}

/** Starts the world before the file's tests and stops it after. Use the getters inside tests. */
export function useWorld(): { world: () => World; port: () => ReturnType<typeof createFakeSelectionPort> } {
    let started: Awaited<ReturnType<typeof startWorld>> | undefined;

    beforeAll(async () => {
        started = await startWorld();
    }, 60_000);
    afterAll(async () => {
        await started?.close();
    });

    return { world: () => started!.world, port: () => started!.port };
}
