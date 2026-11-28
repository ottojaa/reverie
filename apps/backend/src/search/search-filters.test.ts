import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { SearchQuerySchema, type DocumentSearchResult } from '@reverie/shared';
import { seedDocument, seedUser, type SeedDocument } from '../testing/seed.js';
import { describeDb, run, useWorld } from '../testing/tool-world.js';
import { search } from './search.service';

/** The `date:` and `type:` filters, asked through the web search and through the agent's `search_documents` tool. */

interface Found {
    names: string[];
    /** The date each result is shown with, in result order. */
    dates: Array<string | null>;
}

type Sorting = { sort_by?: 'date'; sort_order?: 'asc' | 'desc' };

async function searchWeb(userId: string, q: string, sorting: Sorting = {}): Promise<Found> {
    const response = await search(SearchQuerySchema.parse({ q, limit: 100, ...sorting }), { userId });
    const documents = response.results.filter((result): result is DocumentSearchResult => result.result_type === 'document');

    expect(response.total).toBe(documents.length);

    return { names: documents.map((d) => d.filename), dates: documents.map((d) => d.extracted_date) };
}

async function searchAgent(userId: string, q: string, sorting: Sorting = {}): Promise<Found> {
    const output = await run(userId, 'search_documents', { query: q, limit: 100, ...sorting });
    const rows: Array<{ filename: string; date: string | null }> = output.rows;

    expect(output.total).toBe(rows.length);

    return { names: rows.map((row) => row.filename), dates: rows.map((row) => row.date) };
}

const CALLERS = [
    { caller: 'the web search', find: searchWeb },
    { caller: 'search_documents', find: searchAgent },
];

describeDb('the date: filter', () => {
    const ctx = useWorld();
    let userId: string;

    beforeAll(async () => {
        const { db } = ctx.world();
        userId = await seedUser(db, 'dated');
        const seed = (doc: Omit<SeedDocument, 'userId'>) => seedDocument(db, { userId, ...doc });
        /** `clock` is the camera's clock reading, which is stored as if it were UTC. */
        const camera = (name: string, clock: string, extractedDate?: Date) =>
            seed({
                name,
                mime: 'image/jpeg',
                category: 'photo',
                extractedDate,
                cameraReadAt: new Date(),
                photo: { takenAt: new Date(clock + 'Z'), cameraMake: 'Apple' },
            });

        await camera('summer.jpg', '2024-07-15T12:00:00');
        await camera('new-year.jpg', '2024-01-01T00:30:00');
        await camera('new-years-eve.jpg', '2023-12-31T23:30:00');
        // A date read from the picture is never shown for a camera photo, so it must not be filtered on either.
        await camera('misread.jpg', '2024-09-01T12:00:00', new Date(2020, 4, 1));
        const letter = (name: string, extractedDate: Date, createdAt: string) =>
            seed({ name, category: 'letter', extractedDate, createdAt: new Date(createdAt) });

        await letter('letter-2023.pdf', new Date(2023, 4, 10), '2024-07-15T20:00:00Z');
        await letter('letter-2024.pdf', new Date(2024, 2, 5), '2024-07-16T01:00:00Z');
        // The day after a month range ends.
        await letter('autumn.pdf', new Date(2024, 9, 1), '2024-10-02T00:00:00Z');
    }, 60_000);

    const BY_DATE = [
        ['new-years-eve.jpg', '2023-12-31'],
        ['new-year.jpg', '2024-01-01'],
        ['letter-2024.pdf', '2024-03-05'],
        ['summer.jpg', '2024-07-15'],
        ['misread.jpg', '2024-09-01'],
        ['autumn.pdf', '2024-10-01'],
    ] as const;

    it.each(CALLERS)('finds camera photos by capture date and documents by their own date: $caller', async ({ find }) => {
        expect((await find(userId, 'date:2024')).names.sort()).toEqual(['autumn.pdf', 'letter-2024.pdf', 'misread.jpg', 'new-year.jpg', 'summer.jpg']);
        expect((await find(userId, 'date:2023')).names.sort()).toEqual(['letter-2023.pdf', 'new-years-eve.jpg']);
        expect((await find(userId, 'date:2024-07..2024-09')).names.sort()).toEqual(['misread.jpg', 'summer.jpg']);
        expect((await find(userId, 'date:2020')).names).toEqual([]);
    });

    it.each(CALLERS)('takes a day range through its last day: $caller', async ({ find }) => {
        expect((await find(userId, 'date:2024-01-01..2024-03-05')).names.sort()).toEqual(['letter-2024.pdf', 'new-year.jpg']);
        expect((await find(userId, 'uploaded:2024-07-01..2024-07-15')).names).toEqual(['letter-2023.pdf']);
        expect((await find(userId, 'uploaded:2024-07-16..2024-07-16')).names).toEqual(['letter-2024.pdf']);
    });

    it.each(CALLERS)('sorts by the date each result shows: $caller', async ({ find }) => {
        const expected = [['letter-2023.pdf', '2023-05-10'], ...BY_DATE];
        const ascending = await find(userId, '', { sort_by: 'date', sort_order: 'asc' });
        const descending = await find(userId, '', { sort_by: 'date', sort_order: 'desc' });
        const pairs = (found: Found) => found.names.map((name, i) => [name, found.dates[i]]);

        expect(pairs(ascending)).toEqual(expected);
        expect(pairs(descending)).toEqual([...expected].reverse());
    });
});

describeDb('the type:photo filter', () => {
    const ctx = useWorld();
    let userId: string;

    const PHOTOS = ['beach.jpg', 'loose.png', 'uncategorised.heic', 'worded.png'];
    const OTHERS = ['clip.mp4', 'list.txt', 'notes.md', 'paper.pdf', 'shop.pdf', 'typed.png'];

    beforeAll(async () => {
        const { db } = ctx.world();
        userId = await seedUser(db, 'typed');
        const seed = (name: string, mime: string, category: string | null, ocrText?: string) => seedDocument(db, { userId, name, mime, category, ocrText });

        await seed('beach.jpg', 'image/jpeg', 'photo');
        await seed('loose.png', 'image/png', 'other');
        await seed('worded.png', 'image/png', 'other', 'a sign');
        await seed('uncategorised.heic', 'image/heic', null);
        await seed('typed.png', 'image/png', null, 'a page of words');
        await seed('notes.md', 'text/markdown', 'other', 'notes');
        await seed('paper.pdf', 'application/pdf', 'other', 'a paper');
        await seed('list.txt', 'text/plain', 'other');
        await seed('clip.mp4', 'video/mp4', 'photo');
        await seed('shop.pdf', 'application/pdf', 'receipt', 'a receipt');
    }, 60_000);

    it.each(CALLERS)('returns images only, and -type:photo returns everything else: $caller', async ({ find }) => {
        expect((await find(userId, 'type:photo')).names.sort()).toEqual(PHOTOS);
        expect((await find(userId, '-type:photo')).names.sort()).toEqual(OTHERS);
    });

    it.each(CALLERS)('keeps the image check to photo when other types are asked for too: $caller', async ({ find }) => {
        expect((await find(userId, 'type:photo type:receipt')).names.sort()).toEqual([...PHOTOS, 'shop.pdf'].sort());
        expect((await find(userId, '-type:photo -type:receipt')).names.sort()).toEqual(OTHERS.filter((name) => name !== 'shop.pdf'));
    });

    it('counts in the type facet what the filter returns', async () => {
        const response = await search(SearchQuerySchema.parse({ q: '' }), { userId });
        const facet = response.facets?.types.find((entry) => entry.name === 'photo');

        expect(facet?.count).toBe((await searchWeb(userId, 'type:photo')).names.length);
        expect(facet?.count).toBe(PHOTOS.length);
    });
});
