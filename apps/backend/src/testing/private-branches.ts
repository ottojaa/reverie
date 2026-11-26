import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { seedDocument, seedFolder, seedUser, type SeedDocument } from './seed.js';

/**
 * A small public library, and two private branches to add to it afterwards: one that is private from the top
 * and three folders deep, one that starts three folders deep beneath public ones. Everything private shares its
 * words, tags, category, entities, place and file hashes with something public, so a response that counted or
 * matched any of it would differ from the response taken before the branches existed.
 */

export interface Folder {
    id: string;
    path: string;
}

export interface PublicLibrary {
    userId: string;
    folders: Record<'public' | 'shelf', Folder>;
    docs: Record<'photo' | 'report' | 'copyA' | 'copyB' | 'loose', string>;
}

export interface PrivateBranches {
    /** The two private folders themselves. Their names show on their locked rows. */
    locks: Record<'secretA' | 'secretD', Folder>;
    /** The folders beneath a private one, which nothing may name while it is closed. */
    hidden: Record<'secretB' | 'secretC' | 'secretE', Folder>;
    docs: string[];
    /** The document three folders deep in the first branch. */
    deepDoc: string;
    /** The file hash of a document that exists only in a private folder. */
    privateOnlyHash: string;
    /** Text that belongs to private documents and hidden folders: ids, names, tags, places, entities. */
    markers: string[];
}

/** The word in every document's text, public or private. */
export const SHARED_WORD = 'ZEBRAWORD';
export const SHARED_HASH = 'a'.repeat(64);
const PRIVATE_HASH = 'b'.repeat(64);
const BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

function toShared(userId: string, name: string, folderId: string | null, createdAt: string): SeedDocument {
    return {
        userId,
        name,
        folderId,
        mime: name.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf',
        category: 'receipt',
        ocrText: SHARED_WORD + ' statement',
        summary: 'A statement',
        entities: ['SharedEntity'],
        tags: ['shared-tag'],
        createdAt: new Date(createdAt),
        blurhash: BLURHASH,
        photo: { city: 'Helsinki', country: 'Finland', takenAt: new Date(createdAt) },
    };
}

export async function seedPublicLibrary(db: Kysely<Database>): Promise<PublicLibrary> {
    const userId = await seedUser(db, 'carol-nesting');
    const top = await seedFolder(db, userId, 'Public');
    const shelf = await seedFolder(db, userId, 'Shelf', { parent: top });
    const seed = (name: string, folderId: string | null, day: number, extra: Partial<SeedDocument> = {}) =>
        seedDocument(db, { ...toShared(userId, name, folderId, `2026-02-0${day}T10:00:00Z`), ...extra });
    const docs = {
        photo: await seed('public-photo.jpg', top.id, 1, { hash: SHARED_HASH }),
        report: await seed('public-report.pdf', shelf.id, 2),
        copyA: await seed('copy-a.jpg', shelf.id, 3, { hash: 'c'.repeat(64) }),
        copyB: await seed('copy-b.jpg', shelf.id, 4, { hash: 'c'.repeat(64) }),
        loose: await seed('loose.pdf', null, 5),
    };

    return { userId, folders: { public: top, shelf }, docs };
}

export async function seedPrivateBranches(db: Kysely<Database>, library: PublicLibrary): Promise<PrivateBranches> {
    const { userId, folders } = library;
    const secretA = await seedFolder(db, userId, 'SECRETA', { isPrivate: true });
    const secretB = await seedFolder(db, userId, 'SECRETB', { parent: secretA });
    const secretC = await seedFolder(db, userId, 'SECRETC', { parent: secretB });
    const secretD = await seedFolder(db, userId, 'SECRETD', { parent: folders.shelf, isPrivate: true });
    const secretE = await seedFolder(db, userId, 'SECRETE', { parent: secretD });
    // Newer than every public document, so a cover or a recent list that included them would lead with them.
    const seed = (name: string, folderId: string, hash: string) =>
        seedDocument(db, {
            ...toShared(userId, name, folderId, '2026-03-01T10:00:00Z'),
            hash,
            ocrText: SHARED_WORD + ' SECRETWORD',
            entities: ['SharedEntity', 'SecretEntity'],
            tags: ['shared-tag', 'secrettag'],
        });
    const docs = [
        await seed('secret-a.jpg', secretA.id, SHARED_HASH),
        await seed('secret-b.pdf', secretB.id, PRIVATE_HASH),
        await seed('secret-c.jpg', secretC.id, SHARED_HASH),
        await seed('secret-c2.jpg', secretC.id, 'c'.repeat(64)),
        await seed('secret-d.jpg', secretD.id, SHARED_HASH),
        await seed('secret-e.jpg', secretE.id, 'c'.repeat(64)),
    ];

    await db.updateTable('photo_metadata').set({ city: 'Secretville' }).where('document_id', '=', docs[2]!).execute();

    const hidden = { secretB, secretC, secretE };
    const markers = [
        ...docs,
        ...Object.values(hidden).map((folder) => folder.id),
        'SECRETB',
        'SECRETC',
        'SECRETE',
        'secret-',
        'secrettag',
        'SecretEntity',
        'Secretville',
        'SECRETWORD',
    ];

    return { locks: { secretA, secretD }, hidden, docs, deepDoc: docs[2]!, privateOnlyHash: PRIVATE_HASH, markers };
}
