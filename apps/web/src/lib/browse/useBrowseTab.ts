import { useLocalStorage } from 'usehooks-ts';
import { BROWSE_TAB_STORAGE_KEY, parseBrowseTab, type BrowseTab } from './browse-tabs';

/**
 * The open Browse tab, remembered on this device: All the first time, then the last one used. useLocalStorage reads
 * it during the first render, so coming back from the viewer opens the same tab at once and the router's scroll
 * restoration lands on its list.
 */
export function useBrowseTab(): [BrowseTab, (tab: BrowseTab) => void] {
    const [tab, setTab] = useLocalStorage<BrowseTab>(BROWSE_TAB_STORAGE_KEY, 'all', { deserializer: parseBrowseTab });

    return [tab, setTab];
}
