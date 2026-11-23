import type { DocumentKind } from '@reverie/shared';

/** The tabs of Browse: everything, or one kind of file (by MIME type). */
export type BrowseTab = 'all' | DocumentKind;

export const BROWSE_TABS: ReadonlyArray<{ tab: BrowseTab; label: string }> = [
    { tab: 'all', label: 'All' },
    { tab: 'image', label: 'Photos' },
    { tab: 'video', label: 'Videos' },
    { tab: 'file', label: 'Files' },
];

export const BROWSE_TAB_STORAGE_KEY = 'reverie:browse-tab:v1';

export function isBrowseTab(value: unknown): value is BrowseTab {
    return BROWSE_TABS.some((entry) => entry.tab === value);
}

/** The `kind` a tab asks the server for; All asks for no kind. */
export function kindOfTab(tab: BrowseTab): DocumentKind | undefined {
    return tab === 'all' ? undefined : tab;
}

/**
 * Reads the stored tab (useLocalStorage keeps it as JSON): anything that isn't one of the tabs, such as a value from
 * a later version or a hand-edited one, opens All.
 */
export function parseBrowseTab(stored: string): BrowseTab {
    try {
        const value: unknown = JSON.parse(stored);

        return isBrowseTab(value) ? value : 'all';
    } catch {
        return 'all';
    }
}

const NOUNS: Record<BrowseTab, [one: string, many: string]> = {
    all: ['file', 'files'],
    image: ['photo', 'photos'],
    video: ['video', 'videos'],
    file: ['file', 'files'],
};

/** What the title's subtitle says: the open tab's server total ("168 photos"). */
export function tabSubtitle(tab: BrowseTab, total: number): string {
    const [one, many] = NOUNS[tab];

    return `${total} ${total === 1 ? one : many}`;
}

/** What an empty tab says, in a library or folder that has no documents of its kind. */
export function emptyTabMessage(tab: BrowseTab, isFolderView: boolean): string {
    const noun = NOUNS[tab][1];

    return isFolderView ? `No ${noun} in this folder yet` : `No ${noun} yet`;
}
