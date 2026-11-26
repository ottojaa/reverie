import { Button } from '@/components/ui/button';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { toIndent, toTotalCount, type FolderRow } from '@/lib/folders/tree.js';
import { cn } from '@/lib/utils';
import { useVault } from '@/lib/vault';
import type { FolderWithChildren } from '@reverie/shared';
import { Check, FolderX } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { FolderPadlock } from './FolderPadlock';

interface PickRowProps {
    depth: number;
    name: string;
    icon: ReactNode;
    isSelected: boolean;
    onPick: () => void;
    children?: ReactNode;
}

function PickRow({ depth, name, icon, isSelected, onPick, children }: PickRowProps) {
    return (
        <Button
            type="button"
            variant="ghost"
            className={cn(
                'h-auto w-full shrink-0 justify-start gap-2 py-1.5 pr-2 text-left font-medium',
                isSelected
                    ? 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/10'
                    : 'hover:bg-secondary/80 hover:text-foreground dark:hover:bg-secondary/80',
            )}
            style={{ paddingLeft: toIndent(depth) }}
            aria-pressed={isSelected}
            title={name}
            onClick={onPick}
        >
            {icon}
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {children}
            {isSelected && <Check className="size-4 shrink-0 text-primary" />}
        </Button>
    );
}

const ARROW_STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** Up and Down walk the rows, as in a menu. */
function moveRowFocus(event: KeyboardEvent<HTMLDivElement>) {
    const step = ARROW_STEPS[event.key];

    if (!step) return;

    event.preventDefault();

    const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
    const next = buttons.indexOf(document.activeElement as HTMLButtonElement) + step;

    buttons[Math.min(Math.max(next, 0), buttons.length - 1)]?.focus();
}

interface FolderPickListProps {
    rows: FolderRow[];
    /** The picked folder's id, null for the top level, undefined while nothing is picked. */
    selected: string | null | undefined;
    onPick: (folderId: string | null) => void;
    /** Offers "No folder (top level)" first. */
    hasTopLevel?: boolean;
    /** Shows how many files each folder holds, subfolders included. */
    hasCounts?: boolean;
    emptyText: string;
}

/** Folders of any depth as one indented list to pick from. A locked folder asks for the password before it is picked. */
export function FolderPickList({ rows, selected, onPick, hasTopLevel = false, hasCounts = false, emptyText }: FolderPickListProps) {
    const { requestUnlock } = useVault();

    async function pickFolder(folder: FolderWithChildren) {
        if (folder.locked && !(await requestUnlock(folder.id))) return;

        onPick(folder.id);
    }

    return (
        <div className="flex flex-col gap-0.5" onKeyDown={moveRowFocus}>
            {hasTopLevel && (
                <PickRow
                    depth={0}
                    name="No folder (top level)"
                    icon={<FolderX className="size-4 shrink-0 text-muted-foreground" />}
                    isSelected={selected === null}
                    onPick={() => onPick(null)}
                />
            )}
            {rows.map(({ folder, depth }) => (
                <PickRow
                    key={folder.id}
                    depth={depth}
                    name={folder.name}
                    icon={<SectionIcon value={folder.emoji || 'folder'} className="shrink-0" />}
                    isSelected={selected === folder.id}
                    onPick={() => void pickFolder(folder)}
                >
                    <FolderPadlock folder={folder} />
                    {hasCounts && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{toTotalCount(folder)}</span>}
                </PickRow>
            ))}
            {rows.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</p>}
        </div>
    );
}
