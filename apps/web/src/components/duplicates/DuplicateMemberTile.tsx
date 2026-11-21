import { Button } from '@/components/ui/button';
import { FileTypeIcon } from '@/components/ui/FileTypeIcon';
import { formatDate, formatFileSize, getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { DuplicateMember } from '@reverie/shared';
import { Check, Folder } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { formatFileType, formatResolution } from './format';

interface DuplicateMemberTileProps {
    member: DuplicateMember;
    /** This copy stays; the others in its group go to the Trash. */
    isKept: boolean;
    isSuggested: boolean;
    disabled: boolean;
    onKeep: () => void;
}

/** One copy in a group: its picture and the facts that tell copies apart. Pressing it picks it as the copy to keep. */
export function DuplicateMemberTile({ member, isKept, isSuggested, disabled, onKeep }: DuplicateMemberTileProps) {
    const url = getThumbnailUrl(member, 'md');

    return (
        <div
            className={cn(
                'flex min-w-0 flex-col overflow-hidden rounded-lg bg-secondary/60 ring-2 transition-shadow',
                isKept ? 'ring-primary' : 'ring-transparent',
            )}
        >
            <Button
                type="button"
                variant="ghost"
                aria-pressed={isKept}
                aria-label={`Keep ${member.filename}`}
                disabled={disabled}
                onClick={onKeep}
                className="relative aspect-4/3 h-auto w-full rounded-none bg-muted p-0 hover:bg-muted"
            >
                {url ? (
                    <img src={url} alt={member.filename} className="size-full object-contain" loading="lazy" />
                ) : (
                    <FileTypeIcon mimeType={member.mime_type} filename={member.filename} size="lg" />
                )}
                <span
                    className={cn(
                        'absolute top-2 left-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        isKept ? 'bg-primary text-primary-foreground' : 'bg-background/80 text-muted-foreground',
                    )}
                >
                    {isKept && <Check className="size-3" aria-hidden />}
                    {isKept ? 'Keep' : 'Move to Trash'}
                </span>
            </Button>
            <div className="min-w-0 space-y-1 p-3 text-xs text-muted-foreground">
                <Link
                    to="/document/$id"
                    params={{ id: member.id }}
                    className="block truncate text-sm font-medium text-foreground hover:underline"
                    title={member.filename}
                >
                    {member.filename}
                </Link>
                {isSuggested && <p className="text-primary">Suggested: largest, original, oldest</p>}
                <p>
                    {formatResolution(member)} · {formatFileSize(member.size_bytes)} · {formatFileType(member.mime_type)}
                </p>
                <p>{formatDate(member.date)}</p>
                <p className="flex items-center gap-1 truncate" title={member.folder_path ?? 'Not in a folder'}>
                    <Folder className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{member.folder_path ?? 'Not in a folder'}</span>
                </p>
            </div>
        </div>
    );
}
