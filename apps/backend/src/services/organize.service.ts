/**
 * Organize Service
 *
 * Applies a manual organization plan (move documents, create and delete folders) in one transaction.
 * The AI side of organizing lives in the in-app agent, which works through the tool registry instead.
 */

import type { OrganizeOperation, OrganizeTargetFolder } from '@reverie/shared';
import type { Kysely } from 'kysely';
import { db } from '../db/kysely';
import type { Database, Folder } from '../db/schema';
import type { FolderLocks } from './folder-locks';
import { assertLiveFolder, loadFolderTree } from './folders/load.js';
import type { FolderTree } from './folders/snapshot.js';
import { lockFolders } from './folders/transaction.js';
import { trashEmptyFolder } from './folders/trash.js';
import { findByNames, getOrCreateFolders } from './folders/writes.js';
import { excludeTrashed } from './privacy';

export interface ExecuteOrganizeOptions {
    operations: OrganizeOperation[];
    userId: string;
    locks: FolderLocks;
}

export interface ExecuteOrganizeResult {
    moved_count: number;
    folders_created: number;
    folders_deleted: number;
}

type MoveOperation = Extract<OrganizeOperation, { type: 'move' | 'create_and_move' }>;

function isMoveOperation(op: OrganizeOperation): op is MoveOperation {
    return op.type === 'move' || op.type === 'create_and_move';
}

interface Destination {
    folderId: string;
    createdCount: number;
}

/** Walks `names` down from `parentId`, creating what is missing. The deepest folder already there must be open. */
function createDestination(
    trx: Kysely<Database>,
    tree: FolderTree<Folder>,
    parentId: string | null,
    names: string[],
    { userId, locks }: ExecuteOrganizeOptions,
): Promise<Destination> {
    locks.assertOpen(findByNames(tree, parentId, names).deepestId);

    return getOrCreateFolders(userId, parentId, names, trx);
}

/**
 * The folder an operation moves its documents into, created if it has to be; null when the operation names
 * none. Writing into a folder, or creating one beneath it, needs its lock open.
 */
async function resolveDestination(trx: Kysely<Database>, target: OrganizeTargetFolder, options: ExecuteOrganizeOptions): Promise<Destination | null> {
    const tree = await loadFolderTree(options.userId, trx);

    if (target.id) {
        assertLiveFolder(tree, target.id);
        options.locks.assertOpen(target.id);

        return { folderId: target.id, createdCount: 0 };
    }

    if (!target.is_new) return null;

    if (target.new_parent_name) return createDestination(trx, tree, null, [target.new_parent_name, target.name], options);

    // A parent that is gone since the plan was made takes the operation with it.
    if (!target.parent_id || tree.folder(target.parent_id)?.deleted_at !== null) return null;

    return createDestination(trx, tree, target.parent_id, [target.name], options);
}

export async function executeOrganize(options: ExecuteOrganizeOptions): Promise<ExecuteOrganizeResult> {
    const { operations, userId, locks } = options;
    const moveOps = operations.filter(isMoveOperation);
    const deleteOps = operations.filter((op): op is Extract<OrganizeOperation, { type: 'delete_folder' }> => op.type === 'delete_folder');

    return db.transaction().execute(async (trx) => {
        await lockFolders(trx, userId);

        let movedCount = 0;
        let foldersCreated = 0;
        let foldersDeleted = 0;

        // Process moves first so folders we intend to delete can become empty.
        // If a folder still has docs (e.g. user removed some moves from the proposal), trashEmptyFolder throws and we skip.
        for (const op of moveOps) {
            const destination = await resolveDestination(trx, op.target_folder, options);

            foldersCreated += destination?.createdCount ?? 0;

            if (!destination || op.document_ids.length === 0) continue;

            const result = await excludeTrashed(
                trx
                    .updateTable('documents')
                    .set({ folder_id: destination.folderId, updated_at: new Date() })
                    .where('id', 'in', op.document_ids)
                    .where('user_id', '=', userId),
                '',
            ).executeTakeFirst();

            movedCount += Number(result.numUpdatedRows ?? 0);
        }

        // Process deletes (folders should now be empty after moves)
        for (const op of deleteOps) {
            if (locks.isHidden(op.folder_id)) locks.assertOpen(op.folder_id);

            try {
                await trashEmptyFolder(userId, op.folder_id, trx);
                foldersDeleted++;
            } catch {
                // Skip if folder is not empty (e.g. user removed some docs from proposal)
            }
        }

        return { moved_count: movedCount, folders_created: foldersCreated, folders_deleted: foldersDeleted };
    });
}
