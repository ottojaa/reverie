import type { DocumentKind } from '@reverie/shared';

const KINDS: readonly DocumentKind[] = ['image', 'video', 'file'];

export function isBrowseKind(value: unknown): value is DocumentKind {
    return KINDS.some((kind) => kind === value);
}

/** The search of the Browse routes: `kind` opens that kind's own view, none (or anything else) is the dashboard. */
export interface BrowseSearch {
    kind?: DocumentKind | undefined;
}

/**
 * The router merges its parent's raw search under what a route validates, so a bad `kind` that was merely left out
 * would come back through; it has to be set to undefined to be gone.
 */
export function parseBrowseSearch(search: Record<string, unknown>): BrowseSearch {
    return { kind: isBrowseKind(search.kind) ? search.kind : undefined };
}

const NOUNS: Record<DocumentKind, [one: string, many: string]> = {
    image: ['photo', 'photos'],
    video: ['video', 'videos'],
    file: ['file', 'files'],
};

const TITLES: Record<DocumentKind, string> = { image: 'Photos', video: 'Videos', file: 'Files' };

export function kindTitle(kind: DocumentKind): string {
    return TITLES[kind];
}

/** What the kind view's subtitle says: the kind's server total and where it is counted ("38 photos · My Files"). */
export function kindSubtitle(kind: DocumentKind, total: number, scopeName: string): string {
    const [one, many] = NOUNS[kind];

    return `${total} ${total === 1 ? one : many} · ${scopeName}`;
}

/** What an empty kind view says, in a library or folder that has no documents of its kind. */
export function emptyKindMessage(kind: DocumentKind, isFolderView: boolean): string {
    const noun = NOUNS[kind][1];

    return isFolderView ? `No ${noun} in this folder yet` : `No ${noun} yet`;
}
