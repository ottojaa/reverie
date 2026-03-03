import { formatDate, getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { SearchResult } from '@reverie/shared';
import { FileText, Image, Receipt } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';

interface SearchResultItemProps {
    result: SearchResult;
    isActive?: boolean;
    compact?: boolean;
    onClick?: () => void;
    /** When set, shows a checkbox for multi-select and row click toggles selection instead of calling onClick */
    selected?: boolean;
    onToggle?: (id: string) => void;
}

const categoryIcons: Record<string, typeof FileText> = {
    photo: Image,
    screenshot: Image,
    graphic: Image,
    receipt: Receipt,
    invoice: Receipt,
};

function getCategoryIcon(category: string | null, mimeType: string) {
    if (category && categoryIcons[category]) return categoryIcons[category];

    if (mimeType.startsWith('image/')) return Image;

    return FileText;
}

const IMAGE_CATEGORIES = new Set(['photo', 'screenshot', 'graphic']);

function isImageResult(result: SearchResult): boolean {
    return (result.category !== null && IMAGE_CATEGORIES.has(result.category)) || result.mime_type.startsWith('image/');
}

export const SearchResultItem = memo(function SearchResultItem({
    result,
    isActive,
    compact,
    onClick,
    selected,
    onToggle,
}: SearchResultItemProps) {
    const Icon = getCategoryIcon(result.category, result.mime_type);
    const thumbnailUrl = getThumbnailUrl(result, compact ? 'sm' : 'md');
    const isPhoto = isImageResult(result);
    const displayName = result.display_name;
    const date = result.extracted_date ?? result.uploaded_at;
    const datePrefix = result.extracted_date ? '' : 'Uploaded ';
    const containingFolder = result.folder_path ? result.folder_path.split('/').reverse()[1] : null;

    const isSelectable = onToggle !== undefined;
    const handleClick = isSelectable ? () => onToggle(result.document_id) : onClick;

    if (compact) {
        return (
            <Button
                type="button"
                variant="ghost"
                onClick={handleClick}
                className={cn(
                    'h-auto flex w-full min-w-0 shrink justify-start gap-3 px-3 py-2 text-left',
                    isActive && 'bg-secondary',
                    isSelectable && selected && 'bg-primary/5',
                )}
            >
                {isSelectable && (
                    <div role="presentation" onClick={(e) => e.stopPropagation()} className="shrink-0">
                        <Checkbox checked={selected} onCheckedChange={() => onToggle(result.document_id)} />
                    </div>
                )}
                {thumbnailUrl ? (
                    <img src={thumbnailUrl} alt="" className="size-8 shrink-0 rounded object-cover bg-muted" />
                ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                        <Icon className="size-4 text-muted-foreground" />
                    </div>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{displayName}</span>
            </Button>
        );
    }

    return (
        <Button
            type="button"
            variant="ghost"
            onClick={handleClick}
            className={cn(
                'h-auto flex w-full min-w-0 shrink items-start justify-start gap-3 overflow-hidden px-3 py-2.5 text-left',
                isActive && 'bg-secondary',
                isSelectable && selected && 'bg-primary/5',
            )}
        >
            {isSelectable && (
                <div role="presentation" onClick={(e) => e.stopPropagation()} className="shrink-0 pt-0.5">
                    <Checkbox checked={selected} onCheckedChange={() => onToggle(result.document_id)} />
                </div>
            )}
            {/* Thumbnail / Icon */}
            {thumbnailUrl ? (
                <img src={thumbnailUrl} alt="" className={cn('shrink-0 rounded-md object-cover bg-muted', isPhoto ? 'h-12 w-16' : 'size-10')} />
            ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-5 text-muted-foreground" />
                </div>
            )}

            {/* Content */}
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground"></span>
                </div>

                {result.snippet && (
                    <p
                        className="mt-0.5 truncate text-xs text-muted-foreground [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                )}

                <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
                    {containingFolder && (
                        <span className="flex min-w-0 shrink items-center gap-1">
                            <Badge>{containingFolder}</Badge>
                        </span>
                    )}
                    <span className="ml-auto shrink-0">
                        {datePrefix}
                        {formatDate(date)}
                    </span>
                </div>
            </div>
        </Button>
    );
});
