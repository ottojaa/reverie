import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));

import { queueUnderstanding } from '../llm/understand-backfill.js';
import { isDocumentPrivate } from '../services/privacy.js';
import { seedPrivateBranches, seedPublicLibrary, type PrivateBranches, type PublicLibrary } from '../testing/private-branches.js';
import { describeDb, refusal, run, useWorld } from '../testing/tool-world.js';
import { toDeliverableEvent } from '../websocket/redis-subscriber.js';
import { TOOLS } from './registry.js';

const READS: Array<[string, Record<string, unknown>]> = [
    ['search_documents', {}],
    ['search_documents', { query: 'ZEBRAWORD' }],
    ['search_documents', { query: 'secrettag' }],
    ['search_documents', { folder: 'SECRETC' }],
    ['find_duplicates', {}],
    ['list_folders', {}],
    ['list_folder_contents', {}],
    ['get_library_overview', {}],
];

const WRITES = ['add_tags', 'remove_tags', 'move_documents', 'create_folder', 'rename_folder', 'rename_document', 'undo_write'];

/** A tool answer without the fields that differ between any two identical calls, or repeat what was asked. */
const toStable = (output: unknown): string => JSON.stringify(output, (key, value) => (['selection_id', 'timing_ms'].includes(key) ? undefined : value));

describeDb('private folders at any depth: agent tools, LLM workers and websocket payloads', () => {
    const ctx = useWorld();
    let library: PublicLibrary;
    let branches: PrivateBranches;
    let before: Array<{ asked: string; answer: string }>;

    const fetchReads = async () => {
        const folderReads: Array<[string, Record<string, unknown>]> = Object.values(library.folders).flatMap((folder) => [
            ['list_folder_contents', { folder_id: folder.id }],
            ['search_documents', { folder_id: folder.id }],
        ]);
        const answers: Array<{ asked: string; answer: string }> = [];

        for (const [name, input] of [...READS, ...folderReads]) {
            answers.push({ asked: name + ' ' + JSON.stringify(input), answer: toStable(await run(library.userId, name, input)) });
        }

        return answers;
    };

    /** Tools have no unlock, so the private folders' own names and ids are as secret as what they hold. */
    const toToolMarkers = (): string[] => [...branches.markers, ...Object.values(branches.locks).map((folder) => folder.id), 'SECRETA', 'SECRETD'];

    /** An answer may repeat what the call itself named (a folder id, a typed filter), and nothing else private. */
    const expectNoMarkers = (answer: string, asked: string) => {
        for (const marker of toToolMarkers().filter((text) => !asked.includes(text))) expect(answer, asked + ' shows ' + marker).not.toContain(marker);
    };

    const toPrivateFolderIds = (): string[] => [...Object.values(branches.locks), ...Object.values(branches.hidden)].map((folder) => folder.id);

    beforeAll(async () => {
        library = await seedPublicLibrary(ctx.world().db);
        before = await fetchReads();
        branches = await seedPrivateBranches(ctx.world().db, library);
    }, 60_000);

    it('covers every tool there is', () => {
        const covered = new Set([...READS.map(([name]) => name), 'get_document', ...WRITES]);

        expect([...covered].sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
    });

    it('answers every read as if the private branches did not exist', async () => {
        const after = await fetchReads();

        expect(before.map(({ answer }) => answer).join()).toContain('public-report.pdf');
        expect(after).toEqual(before);

        for (const { asked, answer } of after) expectNoMarkers(answer, asked);
    });

    it('refuses to read or change anything beneath a private folder', async () => {
        const { userId } = library;
        const calls: Array<[string, Record<string, unknown>]> = [
            ...branches.docs.flatMap(
                (id): Array<[string, Record<string, unknown>]> => [
                    ['get_document', { document_id: id }],
                    ['add_tags', { document_ids: [id], tags: ['x'], dry_run: false }],
                    ['remove_tags', { document_ids: [id], tags: ['secrettag'], dry_run: false }],
                    ['move_documents', { document_ids: [id], folder_id: null, dry_run: false }],
                    ['rename_document', { document_id: id, new_name: 'x.pdf', dry_run: false }],
                ],
            ),
            ...toPrivateFolderIds().flatMap(
                (id): Array<[string, Record<string, unknown>]> => [
                    ['list_folder_contents', { folder_id: id }],
                    ['create_folder', { name: 'x', parent_id: id, dry_run: false }],
                    ['rename_folder', { folder_id: id, new_name: 'x', dry_run: false }],
                    ['move_documents', { document_ids: [library.docs.loose], folder_id: id, dry_run: false }],
                ],
            ),
        ];

        for (const [name, input] of calls) expectNoMarkers(await refusal(userId, name, input), name + ' ' + JSON.stringify(input));

        for (const id of toPrivateFolderIds()) {
            const found = (await run(userId, 'search_documents', { folder_id: id }).catch(() => ({ total: 0 }))) as { total: number };

            expect(found.total).toBe(0);
        }
    });

    it('refuses to undo a write whose target has since become private, however deep', async () => {
        const { userId, folders, docs } = library;
        const renamed = (await run(userId, 'rename_document', { document_id: docs.report, new_name: 'renamed.pdf', dry_run: false })) as { audit_id: string };
        const setShelfPrivate = (isPrivate: boolean) =>
            ctx.world().db.updateTable('folders').set({ is_private: isPrivate }).where('id', '=', folders.shelf.id).execute();

        await setShelfPrivate(true);
        await refusal(userId, 'undo_write', { audit_id: renamed.audit_id, dry_run: false });
        await setShelfPrivate(false);
        // The refusal was about privacy alone: the same undo goes through once the folder is public again.
        await run(userId, 'undo_write', { audit_id: renamed.audit_id, dry_run: false });
    });

    it('never queues a private image for the LLM', async () => {
        const { db } = ctx.world();
        const ids = [...branches.docs, library.docs.copyA];
        const addLlmJob = vi.fn();

        await db.deleteFrom('photo_metadata').where('document_id', 'in', ids).execute();
        await db
            .insertInto('document_image_kinds')
            .values(
                ids.map((id) => ({
                    document_id: id,
                    kind: 'screenshot',
                    scores: '{}',
                    signals: '{}',
                    prompt_version: 'test',
                    model: 'test',
                    model_version: 'test',
                })),
            )
            .execute();

        for (const id of branches.docs) {
            const document = await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

            expect(await isDocumentPrivate(document)).toBe(true);
            expect(await queueUnderstanding(db, addLlmJob, id)).toBe('skipped');
        }

        expect(addLlmJob).not.toHaveBeenCalled();
        expect(await queueUnderstanding(db, addLlmJob, library.docs.copyA)).toBe('queued');
    });

    it('sends only the status of a finished job for a private document', async () => {
        const finished = (documentId: string, type: 'job:complete' | 'job:failed') => ({
            type,
            job_id: 'job-1',
            document_id: documentId,
            status: type === 'job:failed' ? ('failed' as const) : ('complete' as const),
            result: { text: 'SECRETWORD' },
            error_message: 'could not read SECRETWORD',
            timestamp: '2026-01-01T00:00:00.000Z',
        });

        for (const id of branches.docs) {
            for (const type of ['job:complete', 'job:failed'] as const) {
                expect(JSON.stringify(await toDeliverableEvent(finished(id, type)))).not.toContain('SECRETWORD');
            }
        }

        expect(await toDeliverableEvent(finished(library.docs.report, 'job:complete'))).toHaveProperty('result');
    });
});
