import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { seedDocument } from '../testing/seed';
import { describeDb, run, useWorld } from '../testing/tool-world';

/**
 * The EXIF and video facts stored for a document are for the owner's own screen. The agent and MCP tools build rows from
 * an allowlist, so none of the new columns may appear in what they return. Each value below is one nothing else in the
 * fixtures can produce, so finding it in the output means a column leaked.
 */
const SENTINELS = [
    '31337',
    '7.77',
    '424242',
    '6789',
    '4321',
    '+05:45',
    'sentinel-codec',
    'sentinel-container',
    'sentinel-audio',
    '987654321',
    'sentinel-profile',
];

describeDb('agent tools and the media facts', () => {
    const ctx = useWorld();

    async function seedMedia() {
        const { db, alice, docs } = ctx.world();

        await db
            .updateTable('photo_metadata')
            .set({
                iso: 31337,
                f_number: 7.77,
                exposure_time: 0.0123,
                focal_length: 424242,
                focal_length_35mm: 424242,
                flash_fired: true,
                orientation: 8,
                taken_at_offset: '+05:45',
                pixel_width: 6789,
                pixel_height: 4321,
            })
            .where('document_id', '=', docs.photo)
            .execute();

        const video = await seedDocument(db, {
            userId: alice,
            name: 'clip.mov',
            mime: 'video/quicktime',
            photo: { takenAt: new Date('2024-05-01T14:03:22Z'), takenAtOffset: '+05:45', city: 'Oulu', country: 'Finland' },
        });

        await db
            .insertInto('video_metadata')
            .values({
                document_id: video,
                container: 'sentinel-container',
                video_codec: 'sentinel-codec',
                video_profile: 'sentinel-profile',
                audio_codec: 'sentinel-audio',
                bitrate: 987654321,
                width: 6789,
                height: 4321,
            })
            .execute();

        return { photo: docs.photo, video };
    }

    it('keeps every new column out of search rows and document details, for a photo and for a video', async () => {
        const { photo, video } = await seedMedia();
        const { alice } = ctx.world();
        const search = await run(alice, 'search_documents', { query: '' });
        const outputs = [search, await run(alice, 'get_document', { document_id: photo }), await run(alice, 'get_document', { document_id: video })];

        for (const sentinel of SENTINELS) {
            for (const output of outputs) expect(JSON.stringify(output)).not.toContain(sentinel);
        }

        // The row shape is exactly what it was before these columns existed.
        const photoRow = search.rows.find((row: { id: string }) => row.id === photo);
        const videoRow = search.rows.find((row: { id: string }) => row.id === video);

        expect(Object.keys(photoRow).sort()).toEqual(['date', 'filename', 'folder', 'id', 'place', 'tags', 'type']);
        expect(Object.keys(videoRow).sort()).toEqual(['date', 'filename', 'folder', 'id', 'place', 'tags', 'type']);
        // A video's place and date are the fields the tools already show for photos.
        expect(videoRow).toMatchObject({ filename: 'clip.mov', place: 'Oulu, Finland', date: '2024-05-01' });
    });
});
