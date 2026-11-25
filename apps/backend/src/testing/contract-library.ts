import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { seedDocument, seedFolder, seedUser, type SeedDocument } from './seed.js';

/**
 * The library behind the response fixtures in libs/shared/src/fixtures:
 *
 *   Photos            holds a photo of its own
 *     Trips
 *       Norway        photos, a video and a screenshot, three folders deep
 *     Surprise party  private, closed
 *   Receipts          a top-level folder holding files
 *   Taxes             private, open
 *     Statements
 *   two documents in no folder
 */
export interface ContractLibrary {
    userId: string;
    folderIds: Record<'photos' | 'trips' | 'norway' | 'party' | 'receipts' | 'taxes' | 'statements', string>;
    /** In the order they were seeded, oldest first. */
    documentIds: string[];
}

async function seedFolders(db: Kysely<Database>, userId: string) {
    const seed = (name: string, options: Parameters<typeof seedFolder>[3] = {}) =>
        seedFolder(db, userId, name, { ...options, createdAt: new Date('2026-01-01T09:00:00Z') });
    const photos = await seed('Photos');
    const trips = await seed('Trips', { parent: photos });
    const norway = await seed('Norway', { parent: trips });
    const party = await seed('Surprise party', { parent: photos, isPrivate: true });
    const receipts = await seed('Receipts');
    const taxes = await seed('Taxes', { isPrivate: true });
    const statements = await seed('Statements', { parent: taxes });

    return {
        photos: photos.id,
        trips: trips.id,
        norway: norway.id,
        party: party.id,
        receipts: receipts.id,
        taxes: taxes.id,
        statements: statements.id,
    };
}

type FixtureDocument = Pick<SeedDocument, 'name' | 'folderId' | 'mime' | 'ocrText' | 'category'>;

function toDocuments(folders: ContractLibrary['folderIds']): FixtureDocument[] {
    const image = 'image/jpeg';

    return [
        { name: 'midsummer.jpg', folderId: folders.photos, mime: image },
        { name: 'fjord.jpg', folderId: folders.norway, mime: image, ocrText: 'holiday by the fjord' },
        { name: 'ferry.mp4', folderId: folders.norway, mime: 'video/mp4' },
        { name: 'Screenshot 2026-06-01.png', folderId: folders.norway, mime: 'image/png', ocrText: 'holiday booking' },
        { name: 'cake.jpg', folderId: folders.party, mime: image },
        { name: 'grocery.pdf', folderId: folders.receipts, category: 'receipt' },
        { name: 'hardware.pdf', folderId: folders.receipts, category: 'receipt' },
        { name: 'return-2025.pdf', folderId: folders.taxes },
        { name: 'bank-statement.pdf', folderId: folders.statements },
        { name: 'welcome.pdf', folderId: null },
        { name: 'scan.jpg', folderId: null, mime: image },
    ];
}

export async function seedContractLibrary(db: Kysely<Database>): Promise<ContractLibrary> {
    const userId = await seedUser(db, 'fixture-owner');
    const folderIds = await seedFolders(db, userId);
    const documentIds: string[] = [];

    for (const [index, document] of toDocuments(folderIds).entries()) {
        const day = String(index + 1).padStart(2, '0');
        const createdAt = new Date('2026-06-' + day + 'T10:00:00Z');
        const hash = day.repeat(32);

        documentIds.push(await seedDocument(db, { ...document, userId, createdAt, hash, blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' }));
    }

    return { userId, folderIds, documentIds };
}
