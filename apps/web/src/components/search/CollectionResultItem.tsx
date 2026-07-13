import { cn } from '@/lib/utils';
import type { CollectionSearchResult } from '@reverie/shared';
import { Folder, FolderOpen } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

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
    const size = compact ? 'size-8' : 'size-10';

    return (
        <Button
            type="button"
            variant="ghost"
            onClick={onClick}
            className={cn(
                'h-auto flex w-full min-w-0 shrink items-start justify-start gap-3 overflow-hidden px-3 py-2.5 text-left',
                isActive && 'bg-secondary',
            )}
        >
            <div className={cn('flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-lg', size)}>
                {result.emoji ? <span aria-hidden>{result.emoji}</span> : <Icon className={cn('text-primary', compact ? 'size-4' : 'size-5')} />}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{result.name}</p>
                    <Badge className="shrink-0">{typeLabel}</Badge>
                </div>

                {result.snippet ? (
                    <p
                        className="mt-0.5 truncate text-xs text-muted-foreground [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                ) : (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{result.path}</p>
                )}

                <div className="mt-1 text-xs text-muted-foreground">
                    {result.document_count} {result.document_count === 1 ? 'document' : 'documents'}
                </div>
            </div>
        </Button>
    );
});
