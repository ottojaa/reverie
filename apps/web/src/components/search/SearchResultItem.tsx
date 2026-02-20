import { formatDate, formatFileSize } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import type { SearchResult } from '@reverie/shared';
import { FileText, Folder, Image, Receipt, Tag } from 'lucide-react';
import { memo } from 'react';

interface SearchResultItemProps {
    result: SearchResult;
    isActive?: boolean;
    compact?: boolean;
    onClick?: () => void;
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

export const SearchResultItem = memo(function SearchResultItem({ result, isActive, compact, onClick }: SearchResultItemProps) {
    const Icon = getCategoryIcon(result.category, result.mime_type);
    const thumbnailUrl = result.thumbnail_url ? `${import.meta.env.VITE_API_URL}${result.thumbnail_url}` : null;
    const isPhoto = isImageResult(result);
    const displayName = result.display_name;
    const date = result.extracted_date ?? result.uploaded_at;
    const datePrefix = result.extracted_date ? '' : 'Uploaded ';
    const showFilename = displayName !== result.filename;
    const containingFolder = result.folder_path ? result.folder_path.split('/').reverse()[1] : null;

    if (compact) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                    'hover:bg-secondary/80 focus-visible:bg-secondary/80 focus-visible:outline-none',
                    isActive && 'bg-secondary',
                )}
            >
                {thumbnailUrl ? (
                    <img src={thumbnailUrl} alt="" className="size-8 shrink-0 rounded object-cover bg-muted" />
                ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                        <Icon className="size-4 text-muted-foreground" />
                    </div>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{displayName}</span>
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                'hover:bg-secondary/80 focus-visible:bg-secondary/80 focus-visible:outline-none',
                isActive && 'bg-secondary',
            )}
        >
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
                        {showFilename && <p className="truncate text-xs text-muted-foreground">{result.filename}</p>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {datePrefix}
                        {formatDate(date)}
                    </span>
                </div>

                {result.snippet && (
                    <p
                        className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                )}

                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {containingFolder && (
                        <span className="flex items-center gap-1 truncate">
                            <Folder className="size-3 shrink-0" />
                            <span className="truncate">{containingFolder}</span>
                        </span>
                    )}
                    {result.tags.length > 0 && (
                        <>
                            {result.tags.slice(0, 2).map((tag) => (
                                <span key={tag} className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                                    <Tag className="size-2.5" />
                                    {tag}
                                </span>
                            ))}
                            {result.tags.length > 2 && <span className="shrink-0 text-[10px]">+{result.tags.length - 2}</span>}
                        </>
                    )}
                    <span className="shrink-0">{formatFileSize(result.size_bytes)}</span>
                </div>
            </div>
        </button>
    );
});
