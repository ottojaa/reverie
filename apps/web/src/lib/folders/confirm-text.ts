import type { FolderWithChildren } from '@reverie/shared';
import { flattenTree, hasOtherLockBelow, toTotalCount } from './tree.js';

function toCountText(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What goes to the trash with a folder. Files behind another lock are never counted. */
function toContentsSentences(folder: FolderWithChildren): string[] {
    if (folder.locked) return ['Everything in it goes to the trash with it.'];

    const files = toTotalCount(folder);
    const counted = files > 0 ? [`${toCountText(files, 'file')} ${files === 1 ? 'goes' : 'go'} to the trash with it.`] : [];

    if (!hasOtherLockBelow(folder)) return counted;

    return [...counted, files > 0 ? 'So does everything in its private folders.' : 'Everything in its private folders goes to the trash with it.'];
}

export function toDeleteFolderMessage(folder: FolderWithChildren): string {
    const subfolders = folder.children.length > 0 ? ' with its subfolders' : '';

    return [`"${folder.name}" will be moved to Trash${subfolders}.`, ...toContentsSentences(folder), 'You can restore it from Trash.'].join(' ');
}

export function toMakePrivateMessage(folder: FolderWithChildren): string {
    const subfolders = toCountText(flattenTree(folder.children).length, 'subfolder');
    const files = toCountText(toTotalCount(folder), 'file');

    return `"${folder.name}", its ${subfolders} and ${files} will only show inside it, never in All documents or search.`;
}
