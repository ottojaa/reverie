/**
 * Which copy of a picture to keep: the largest resolution, then an original over an edited copy, then the oldest.
 * Pure, so the order is easy to test; the last tie-break is the id, so the same group always suggests the same copy.
 */

export interface CopyCandidate {
    id: string;
    filename: string;
    width: number | null;
    height: number | null;
    /** When the picture was taken, else uploaded. */
    date: Date;
}

// The names a copy gets: the in-app editor's "name (Copy).jpg", an upload that kept both files ("name (1).jpg"),
// and the usual "name copy.jpg" / "name-edited.jpg" of other tools.
const EDITED_NAME = /(?:\(copy(?: \d+)?\)|[\s_-]copy(?:[\s_-]?\d+)?|[\s_-]edited|\(\d+\))$/i;

export function isEditedCopyName(filename: string): boolean {
    const dot = filename.lastIndexOf('.');
    const base = (dot > 0 ? filename.slice(0, dot) : filename).trim();

    return EDITED_NAME.test(base);
}

function pixelsOf(copy: CopyCandidate): number {
    return (copy.width ?? 0) * (copy.height ?? 0);
}

function compareCopies(a: CopyCandidate, b: CopyCandidate): number {
    return (
        pixelsOf(b) - pixelsOf(a) ||
        Number(isEditedCopyName(a.filename)) - Number(isEditedCopyName(b.filename)) ||
        a.date.getTime() - b.date.getTime() ||
        a.id.localeCompare(b.id)
    );
}

/** The id of the copy to keep; the group must not be empty. */
export function pickBestCopy(copies: CopyCandidate[]): string {
    const [best] = [...copies].sort(compareCopies);

    if (!best) throw new Error('Cannot pick the best copy of an empty group');

    return best.id;
}
