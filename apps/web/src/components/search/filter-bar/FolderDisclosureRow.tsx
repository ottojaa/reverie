import { Folder } from 'lucide-react';
import { DisclosureRow } from './DimensionDisclosureList';
import { FolderFilterPanel, type FolderFilterProps } from './FolderFilterPanel';

/** The folder filter as a row of the stacked filter menus. */
export function FolderDisclosureRow({ folderId, onChange, expanded, onToggle }: FolderFilterProps & { expanded: boolean; onToggle: () => void }) {
    return (
        <DisclosureRow icon={Folder} label="Folder" badgeCount={folderId ? 1 : 0} expanded={expanded} onToggle={onToggle}>
            <FolderFilterPanel folderId={folderId} onChange={onChange} />
        </DisclosureRow>
    );
}
