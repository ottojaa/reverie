import { cn } from '@/lib/utils';
import type { CollectionSearchResult } from '@reverie/shared';
import { Folder, FolderOpen } from 'lucide-react';
import { memo } from 'react';
import { Button } from '../ui/button';
import { SectionIcon } from '../ui/SectionIcon';

interface CollectionResultItemProps {
    result: CollectionSearchResult;
    isActive?: boolean;
    compact?: boolean;
    onClick?: () => void;
}

/** A collection/folder row in the unified search results (navigates to the browse view). */
export const CollectionResultItem = memo(function CollectionResultItem({ result, isActive, compact, onClick }: CollectionResultItemProps) {
    const Icon = result.folder_type === 'collection' ? FolderOpen : Folder;
    const typeLabel = result.folder_type === 'collection' ? 'Collection' : 'Folder';
    const size = compact ? 'size-8' : 'size-12';

    return (
        <Button
            type="button"
            variant="ghost"
            onClick={onClick}
            className={cn(
                'h-auto flex w-full min-w-0 shrink items-start justify-start gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left hover:bg-secondary/60 dark:hover:bg-secondary/60',
                isActive && 'bg-secondary',
            )}
        >
            <div className={cn('flex shrink-0 items-center justify-center rounded-md bg-muted text-lg', size)}>
                {/* emoji can hold a lucide icon slug — SectionIcon resolves it (never render it as text) */}
                {result.emoji ? (
                    <SectionIcon value={result.emoji} className={cn('text-muted-foreground', compact ? 'size-4' : 'size-5')} />
                ) : (
                    <Icon className={cn('text-muted-foreground', compact ? 'size-4' : 'size-5')} />
                )}
            </div>

            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{result.name}</p>

                {result.snippet ? (
                    <p
                        className="mt-0.5 truncate text-xs text-muted-foreground [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                ) : (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{result.path}</p>
                )}

                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                    <span>{typeLabel}</span>
                    <span aria-hidden className="text-muted-foreground/40">
                        ·
                    </span>
                    <span className="tabular-nums">
                        {result.document_count} {result.document_count === 1 ? 'document' : 'documents'}
                    </span>
                </div>
            </div>
        </Button>
    );
});
