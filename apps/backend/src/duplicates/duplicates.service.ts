import { NotFoundError, ValidationError, type DuplicateGroup, type DuplicateMember, type TrashOthersRequest, type TrashOthersResponse } from '@reverie/shared';
import { db } from '../db/kysely';
import type { FolderLocks } from '../services/folder-locks';
import { getStorageService } from '../services/storage.service';
import { getTrashService } from '../services/trash.service';
import { resolveThumbnailUrls } from '../utils/thumbnail-urls';
import { pickBestCopy } from './best-copy';
import { loadDuplicateClusters, type DuplicateCluster, type DuplicateScope } from './groups';

/** The scope of a request: images outside every private folder, or those behind one lock, which must be open. */
export function resolveScope(locks: FolderLocks, userId: string, folderId?: string): DuplicateScope {
    const privateFolderIds = locks.privateFolderIds;

    if (!folderId) return { userId, privateFolderIds, lockFolderIds: null };

    const lockId = locks.lockIdOf(folderId);

    if (lockId === null) throw new ValidationError('Folder is not private: ' + folderId);

    locks.assertOpen(folderId);

    return { userId, privateFolderIds, lockFolderIds: privateFolderIds.filter((id) => locks.lockIdOf(id) === lockId) };
}

interface MemberRow {
    id: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number | string;
    width: number | null;
    height: number | null;
    created_at: Date;
    taken_at: Date | null;
    folder_id: string | null;
    folder_path: string | null;
    thumbnail_blurhash: string | null;
    thumbnail_paths: Parameters<typeof resolveThumbnailUrls>[1];
}

async function loadMemberRows(ids: string[]): Promise<Map<string, MemberRow>> {
    if (ids.length === 0) return new Map();

    const rows = await db
        .selectFrom('documents as d')
        .leftJoin('folders as f', 'f.id', 'd.folder_id')
        .leftJoin('photo_metadata as pm', 'pm.document_id', 'd.id')
        .select([
            'd.id',
            'd.original_filename',
            'd.mime_type',
            'd.size_bytes',
            'd.width',
            'd.height',
            'd.created_at',
            'pm.taken_at',
            'd.folder_id',
            'f.path as folder_path',
            'd.thumbnail_blurhash',
            'd.thumbnail_paths',
        ])
        .where('d.id', 'in', ids)
        .execute();

    return new Map(rows.map((row) => [row.id, row]));
}

async function toMember(row: MemberRow): Promise<DuplicateMember> {
    return {
        id: row.id,
        filename: row.original_filename,
        mime_type: row.mime_type,
        size_bytes: Number(row.size_bytes),
        width: row.width,
        height: row.height,
        date: (row.taken_at ?? row.created_at).toISOString(),
        folder_id: row.folder_id,
        folder_path: row.folder_path,
        thumbnail_blurhash: row.thumbnail_blurhash,
        thumbnail_urls: await resolveThumbnailUrls(getStorageService(), row.thumbnail_paths),
    };
}

async function toGroup(cluster: DuplicateCluster, rows: Map<string, MemberRow>): Promise<DuplicateGroup> {
    const present = cluster.ids.flatMap((id) => rows.get(id) ?? []);
    const members = await Promise.all(present.map(toMember));
    const suggested = pickBestCopy(
        present.map((row) => ({ id: row.id, filename: row.original_filename, width: row.width, height: row.height, date: row.taken_at ?? row.created_at })),
    );

    return { id: cluster.id, members, suggested_keep_id: suggested, min_similarity: cluster.minSimilarity };
}

/** The duplicate groups in a scope, each with its members and the copy to keep. */
export async function loadDuplicateGroups(scope: DuplicateScope): Promise<DuplicateGroup[]> {
    const clusters = await loadDuplicateClusters(scope);
    const rows = await loadMemberRows(clusters.flatMap((cluster) => cluster.ids));
    const groups = await Promise.all(clusters.map((cluster) => toGroup(cluster, rows)));

    // A member purged between the two reads leaves a group of one, which the response schema rejects.
    return groups.filter((group) => group.members.length >= 2);
}

/**
 * Moves every image but the chosen one of each group to the Trash (restorable). The groups are worked out again here and matched by id,
 * so a group that changed since the list was loaded, or a `keep_id` that is not in it, is skipped rather than trusted: no call can trash
 * every copy of a picture or an image outside the groups.
 */
export async function trashOthers(scope: DuplicateScope, request: TrashOthersRequest): Promise<TrashOthersResponse> {
    const clusters = new Map((await loadDuplicateClusters(scope)).map((cluster) => [cluster.id, cluster]));
    const toTrash = new Set<string>();
    const skipped: string[] = [];

    for (const { group_id, keep_id } of request.groups) {
        const cluster = clusters.get(group_id);

        if (!cluster || !cluster.ids.includes(keep_id)) {
            skipped.push(group_id);
            continue;
        }

        for (const id of cluster.ids) if (id !== keep_id) toTrash.add(id);
    }

    const trashedIds = [...toTrash];

    await getTrashService().trashDocuments(scope.userId, trashedIds);

    return { trashed_ids: trashedIds, skipped_group_ids: skipped };
}

/** "Not duplicates": every pair in the group is remembered and never grouped again. */
export async function dismissGroup(scope: DuplicateScope, groupId: string): Promise<void> {
    const cluster = (await loadDuplicateClusters(scope)).find((candidate) => candidate.id === groupId);

    if (!cluster) throw new NotFoundError('Duplicate group', groupId);

    // Ids are sorted, so every pair comes out as (lower, higher) as the table requires.
    const pairs = cluster.ids.flatMap((a, i) => cluster.ids.slice(i + 1).map((b) => ({ user_id: scope.userId, doc_a: a, doc_b: b })));

    await db
        .insertInto('duplicate_dismissals')
        .values(pairs)
        .onConflict((oc) => oc.columns(['doc_a', 'doc_b']).doNothing())
        .execute();
}
