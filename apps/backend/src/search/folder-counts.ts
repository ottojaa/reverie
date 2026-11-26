import { db } from '../db/kysely';
import { FolderLocks } from '../services/folder-locks';
import { loadFolderTree } from '../services/folders/load';
import { loadFolderRollups } from '../services/folders/rollup';
import { toLockMap } from '../services/privacy';

/**
 * How many documents each of the given public folders holds, counted as the folder tree counts them: every
 * subfolder included, except what sits behind a private folder.
 */
export async function loadPublicFolderCounts(userId: string, folderIds: string[]): Promise<Map<string, number>> {
    if (folderIds.length === 0) return new Map();

    const tree = await loadFolderTree(userId, db);
    const allClosed = new FolderLocks(toLockMap(tree), new Set(), true);
    const rollups = await loadFolderRollups(userId, tree, folderIds, allClosed, { covers: false });

    return new Map(Array.from(rollups, ([id, { kind_counts }]) => [id, kind_counts.image + kind_counts.video + kind_counts.file]));
}
