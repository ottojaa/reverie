import { FolderPickList } from '@/components/folders/FolderPickList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { findFolder, flattenTree, toIndent } from '@/lib/folders/tree.js';
import type { FolderWithChildren } from '@reverie/shared';
import { ArrowLeft, FolderPlus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';

/** Where the picked documents go: a folder (null: the top level), or a folder to create first. */
export type MoveDestination = { type: 'existing'; folderId: string | null } | { type: 'new'; name: string; parentId: string | null };

/** The select's value for the top level: Radix does not allow an empty one. */
const TOP_LEVEL_VALUE = 'top';

interface FolderPickerPanelProps {
    sections: FolderWithChildren[];
    /** The picked folder's id, null for the top level, undefined while nothing is picked. */
    selected: string | null | undefined;
    onSelect: (folderId: string | null) => void;
    onConfirm: (destination: MoveDestination) => void;
    isPending: boolean;
}

function toConfirmLabel(sections: FolderWithChildren[], selected: string | null | undefined): string | null {
    if (selected === null) return 'Move to top level';

    const folder = findFolder(sections, selected);

    return folder ? `Move to "${folder.name}"` : null;
}

/** One of the panel's two views, sliding in from its side. */
function PanelView({ offset, children }: { offset: number; children: ReactNode }) {
    return (
        <motion.div
            initial={{ opacity: 0, x: offset }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: offset }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
            {children}
        </motion.div>
    );
}

function PickView({ sections, selected, onSelect, onConfirm, isPending, onCreate }: FolderPickerPanelProps & { onCreate: () => void }) {
    const label = toConfirmLabel(sections, selected);

    return (
        <PanelView offset={-16}>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                <FolderPickList rows={flattenTree(sections)} selected={selected} onPick={onSelect} hasTopLevel emptyText="No folders yet." />

                <div className="mt-2 border-t border-border pt-2">
                    <Button
                        type="button"
                        variant="ghost"
                        className="w-full justify-start gap-2 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                        onClick={onCreate}
                    >
                        <FolderPlus className="size-4 shrink-0" />
                        New folder
                    </Button>
                </div>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3">
                <Button
                    onClick={() => selected !== undefined && onConfirm({ type: 'existing', folderId: selected })}
                    disabled={label === null || isPending}
                    className="w-full"
                >
                    <span className="truncate">{isPending ? 'Moving...' : (label ?? 'Select a folder')}</span>
                </Button>
            </div>
        </PanelView>
    );
}

function ParentSelect({ sections, value, onChange }: { sections: FolderWithChildren[]; value: string | null; onChange: (value: string | null) => void }) {
    return (
        <Select value={value ?? TOP_LEVEL_VALUE} onValueChange={(next) => onChange(next === TOP_LEVEL_VALUE ? null : next)}>
            <SelectTrigger id="organize-folder-parent" className="[&>span]:truncate">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={TOP_LEVEL_VALUE}>No folder (top level)</SelectItem>
                {flattenTree(sections).map(({ folder, depth }) => (
                    <SelectItem key={folder.id} value={folder.id} style={{ paddingLeft: toIndent(depth) }}>
                        {folder.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function CreateView({ sections, selected, onConfirm, isPending, onBack }: FolderPickerPanelProps & { onBack: () => void }) {
    const [name, setName] = useState('');
    const [parentId, setParentId] = useState(selected ?? null);

    function create() {
        if (!name.trim() || isPending) return;

        onConfirm({ type: 'new', name: name.trim(), parentId });
    }

    return (
        <PanelView offset={16}>
            <div className="shrink-0 border-b border-border px-3 py-2">
                <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-1" onClick={onBack}>
                    <ArrowLeft className="size-3.5" />
                    Back
                </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
                <div className="space-y-1.5">
                    <label htmlFor="organize-folder-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Folder name
                    </label>
                    <Input
                        id="organize-folder-name"
                        autoFocus
                        maxLength={255}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && create()}
                        placeholder="e.g. Travel receipts"
                    />
                </div>

                <div className="space-y-1.5">
                    <label htmlFor="organize-folder-parent" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Inside
                    </label>
                    <ParentSelect sections={sections} value={parentId} onChange={setParentId} />
                </div>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3">
                <Button onClick={create} disabled={!name.trim() || isPending} className="w-full">
                    {isPending ? 'Creating...' : 'Create & move'}
                </Button>
            </div>
        </PanelView>
    );
}

/** The drawer's body: pick a destination, or name a new folder to move into. */
export function FolderPickerPanel(props: FolderPickerPanelProps) {
    const [isCreating, setIsCreating] = useState(false);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
                {isCreating ? (
                    <CreateView key="create" {...props} onBack={() => setIsCreating(false)} />
                ) : (
                    <PickView key="select" {...props} onCreate={() => setIsCreating(true)} />
                )}
            </AnimatePresence>
        </div>
    );
}
