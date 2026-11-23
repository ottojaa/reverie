import { useLocalStorage } from 'usehooks-ts';
import { BROWSE_LAYOUT_STORAGE_KEY, DEFAULT_BROWSE_LAYOUT, parseBrowseLayout, type BrowseLayout } from './browse-layout';

/** The Photos / Videos layout, remembered on this device (one choice for both tabs), Cards until picked. */
export function useBrowseLayout(): [BrowseLayout, (layout: BrowseLayout) => void] {
    const [layout, setLayout] = useLocalStorage<BrowseLayout>(BROWSE_LAYOUT_STORAGE_KEY, DEFAULT_BROWSE_LAYOUT, { deserializer: parseBrowseLayout });

    return [layout, setLayout];
}
