import type { Kysely } from 'kysely';
import type { Database, Folder, FolderType } from '../../db/schema.js';
import { excludeTrashed } from '../privacy.js';
import { loadFolderTree } from './load.js';
import type { FolderTree } from './snapshot.js';

/** A folder's stored `path` and `type`, which both follow from where it sits, and the names beside it. */

export const MAX_FOLDER_NAME_LENGTH = 255;

/** 'collection' at the top level, else 'folder'. Kept for installed clients, which still read it. */
export function toFolderType(parentId: string | null): FolderType {
    return parentId === null ? 'collection' : 'folder';
}

/** The names from the top level down to the folder. */
export function toNamePath(tree: FolderTree<Folder>, folder: Folder): string[] {
    return [...tree.ancestors(folder.id), folder].map((step) => step.name);
}

export function toPath(names: string[]): string {
    return '/' + names.join('/');
}

/** `name` with `ending` after it, cut so that the result is still a valid name. */
export function toSuffixedName(name: string, ending: string): string {
    return name.slice(0, MAX_FOLDER_NAME_LENGTH - ending.length) + ending;
}

/** Whether a live folder directly inside `parentId` has this name, in any case. */
export async function isNameTaken(trx: Kysely<Database>, userId: string, parentId: string | null, name: string, exceptId?: string): Promise<boolean> {
    const query = trx
        .selectFrom('folders')
        .select('id')
        .where('user_id', '=', userId)
        .where('parent_id', parentId === null ? 'is' : '=', parentId)
        .where((eb) => eb(eb.fn('lower', ['name']), '=', eb.fn('lower', [eb.val(name)])))
        .$if(exceptId !== undefined, (qb) => qb.where('id', '!=', exceptId!));

    return (await excludeTrashed(query, '').executeTakeFirst()) !== undefined;
}

/** After a folder was renamed or moved: brings `path` and `type` up to date for it and everything beneath it. */
export async function rewritePaths(trx: Kysely<Database>, userId: string, rootId: string): Promise<void> {
    const tree = await loadFolderTree(userId, trx);

    for (const folder of tree.subtree(rootId, { trashed: true })) {
        const path = toPath(toNamePath(tree, folder));
        const type = toFolderType(folder.parent_id);

        if (folder.path === path && folder.type === type) continue;

        await trx.updateTable('folders').set({ path, type }).where('id', '=', folder.id).execute();
    }
}
