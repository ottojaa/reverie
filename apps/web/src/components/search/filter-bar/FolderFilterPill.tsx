import { Folder } from 'lucide-react';
import { useState } from 'react';
import { FolderFilterPanel, type FolderFilterProps } from './FolderFilterPanel';
import { PillPopover } from './PillPopover';
import { useFolderFilterName } from './useFolderFilterName';

export function FolderFilterPill({ folderId, onChange }: FolderFilterProps) {
    const [open, setOpen] = useState(false);
    const folder = useFolderFilterName(folderId);

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            icon={Folder}
            label={folder ? `Folder: ${folder.name}` : 'Folder'}
            title={folder?.path}
            isActive={folder !== null}
            clearLabel="Clear Folder filter"
            onClear={() => onChange(undefined)}
        >
            <FolderFilterPanel folderId={folderId} onChange={onChange} />
        </PillPopover>
    );
}
