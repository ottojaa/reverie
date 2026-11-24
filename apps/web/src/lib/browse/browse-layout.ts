import type { DocumentKind } from '@reverie/shared';

/** How Photos and Videos draw their documents: cards with a footer, square image-only tiles, or image-only rows. */
export type BrowseLayout = 'cards' | 'grid' | 'justified';

export const BROWSE_LAYOUTS: ReadonlyArray<{ layout: BrowseLayout; label: string }> = [
    { layout: 'cards', label: 'Cards' },
    { layout: 'grid', label: 'Grid' },
    { layout: 'justified', label: 'Justified' },
];

export const BROWSE_LAYOUT_STORAGE_KEY = 'reverie:browse-layout:v1';

export const DEFAULT_BROWSE_LAYOUT: BrowseLayout = 'cards';

export function isBrowseLayout(value: unknown): value is BrowseLayout {
    return BROWSE_LAYOUTS.some((entry) => entry.layout === value);
}

/**
 * Reads the stored layout (useLocalStorage keeps it as JSON): anything that isn't one of the layouts, such as a value
 * from a later version or a hand-edited one, falls back to Cards.
 */
export function parseBrowseLayout(stored: string): BrowseLayout {
    try {
        const value: unknown = JSON.parse(stored);

        return isBrowseLayout(value) ? value : DEFAULT_BROWSE_LAYOUT;
    } catch {
        return DEFAULT_BROWSE_LAYOUT;
    }
}

/** Only Photos and Videos have a choice; Files is a table. */
export function hasLayoutChoice(kind: DocumentKind): boolean {
    return kind === 'image' || kind === 'video';
}
