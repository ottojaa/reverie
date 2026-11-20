import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FileTypeIcon } from '@/components/ui/FileTypeIcon';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { formatDate, formatFileSize, getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { TrashDocument, TrashFolder } from '@reverie/shared';
import { Folder, Lock, LockOpen, RotateCcw, Trash2 } from 'lucide-react';

export type TrashItem = { kind: 'document'; item: TrashDocument } | { kind: 'folder'; item: TrashFolder };

export function toTrashItemKey(entry: TrashItem): string {
    return `${entry.kind}:${entry.item.id}`;
}

/** A private folder or collection whose lock is closed arrives as a bare row without a name. */
export function isLockedFolderEntry(entry: TrashItem): boolean {
    return entry.kind === 'folder' && entry.item.locked;
}

/** "in 12 days", "tomorrow", "soon": when the purge job will remove the item for good. */
export function toPurgeLabel(purgeAt: string, now: Date = new Date()): string {
    const days = Math.ceil((new Date(purgeAt).getTime() - now.getTime()) / 86_400_000);

    if (days <= 0) return 'Purges soon';

    if (days === 1) return 'Purges tomorrow';

    return `Purges in ${days} days`;
}

function TrashThumbnail({ entry }: { entry: TrashItem }) {
    const box = 'flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted';

    if (isLockedFolderEntry(entry)) {
        return (
            <div className={box} title="Locked">
                <Lock className="size-4 text-accent" aria-hidden />
            </div>
        );
    }

    if (entry.kind === 'folder') {
        return (
            <div className={box}>
                {entry.item.emoji ? (
                    <SectionIcon value={entry.item.emoji} className="size-5 text-muted-foreground" />
                ) : (
                    <Folder className="size-5 text-muted-foreground" aria-hidden />
                )}
            </div>
        );
    }

    const doc = entry.item;
    const url = getThumbnailUrl(doc, 'sm');

    return (
        <div className={box}>
            {url ? (
                <img src={url} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
                <FileTypeIcon mimeType={doc.mime_type} filename={doc.original_filename} size="md" />
            )}
        </div>
    );
}

interface TrashRowProps {
    entry: TrashItem;
    selected: boolean;
    busy: boolean;
    onToggle: () => void;
    onRestore: () => void;
    /** Opens the lock of a locked folder so its name shows and it can be restored. */
    onUnlock: () => void;
    onPurge: () => void;
}

export function TrashRow({ entry, selected, busy, onToggle, onRestore, onUnlock, onPurge }: TrashRowProps) {
    const isFolder = entry.kind === 'folder';
    const isLocked = isLockedFolderEntry(entry);
    const name = isFolder ? (isLocked ? 'Locked folder' : entry.item.name) : entry.item.original_filename;
    const detail = isFolder ? (entry.item.type === 'collection' ? 'Collection' : 'Folder') : formatFileSize(entry.item.size_bytes);

    return (
        <li className={cn('flex flex-wrap items-center gap-3 px-4 py-3 transition-colors sm:flex-nowrap', selected && 'bg-accent/10')}>
            <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${name}`} />
            <TrashThumbnail entry={entry} />
            <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-medium" title={name}>
                    {name}
                </p>
                <p className="text-xs text-muted-foreground">
                    {detail} · Deleted {formatDate(entry.item.deleted_at)} · {toPurgeLabel(entry.item.purge_at)}
                </p>
            </div>
            <div className="ml-auto flex shrink-0 gap-2">
                {isLocked ? (
                    <Button type="button" variant="outline" size="sm" onClick={onUnlock} disabled={busy}>
                        <LockOpen className="size-3.5" />
                        Unlock
                    </Button>
                ) : (
                    <Button type="button" variant="outline" size="sm" onClick={onRestore} disabled={busy}>
                        <RotateCcw className="size-3.5" />
                        Restore
                    </Button>
                )}
                {!isLocked && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onPurge} disabled={busy}>
                        <Trash2 className="size-3.5" />
                        Delete forever
                    </Button>
                )}
            </div>
        </li>
    );
}
