import type { DuplicateGroup, DuplicateMember } from '@reverie/shared';

/** "4032 × 3024", or "Unknown size" for an image whose dimensions were never read. */
export function formatResolution(member: Pick<DuplicateMember, 'width' | 'height'>): string {
    if (!member.width || !member.height) return 'Unknown size';

    return `${member.width} × ${member.height}`;
}

/** "JPEG" for `image/jpeg`, "SVG" for `image/svg+xml`: the part after the slash, up to any `+`. */
export function formatFileType(mimeType: string): string {
    const subtype = mimeType.split('/')[1] ?? mimeType;

    const [name = subtype] = subtype.split('+');

    return name.toUpperCase();
}

/** "98% alike" for a group that is not made of byte-identical files, "Identical files" for one that is. */
export function formatSimilarity(minSimilarity: number): string {
    if (minSimilarity >= 1) return 'Identical files';

    return `${Math.floor(minSimilarity * 100)}% alike`;
}

/** The copy to keep in a group: the owner's pick if it is still a member, else the suggested one. */
export function toKeepId(group: DuplicateGroup, picked: string | undefined): string {
    return picked && group.members.some((member) => member.id === picked) ? picked : group.suggested_keep_id;
}

/** How many images "Move others to Trash" would move for these groups. */
export function countToTrash(groups: DuplicateGroup[]): number {
    return groups.reduce((total, group) => total + group.members.length - 1, 0);
}
