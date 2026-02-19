import { cn } from '@/lib/utils';
import type { SearchResult } from '@reverie/shared';
import { FileText, Folder, Image, Receipt } from 'lucide-react';
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

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SearchResultItem = memo(function SearchResultItem({ result, isActive, compact, onClick }: SearchResultItemProps) {
    const Icon = getCategoryIcon(result.category, result.mime_type);
    const thumbnailUrl = result.thumbnail_url ? `${import.meta.env.VITE_API_URL}${result.thumbnail_url}` : null;

    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                'hover:bg-secondary/80 focus-visible:bg-secondary/80 focus-visible:outline-none',
                isActive && 'bg-secondary',
                compact ? 'py-2' : 'py-2.5',
            )}
        >
            {thumbnailUrl ? (
                <img src={thumbnailUrl} alt="" className={cn('shrink-0 rounded object-cover bg-muted', compact ? 'size-8' : 'size-10')} />
            ) : (
                <div className={cn('flex shrink-0 items-center justify-center rounded bg-muted', compact ? 'size-8' : 'size-10')}>
                    <Icon className={cn('text-muted-foreground', compact ? 'size-4' : 'size-5')} />
                </div>
            )}

            <div className="min-w-0 flex-1">
                <p className={cn('truncate font-medium', compact ? 'text-sm' : 'text-sm')}>{result.filename}</p>

                {result.snippet && !compact && (
                    <p
                        className="mt-0.5 line-clamp-2 text-xs text-muted-foreground [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                )}

                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {result.folder_path && (
                        <span className="flex items-center gap-1 truncate">
                            <Folder className="size-3 shrink-0" />
                            <span className="truncate">{result.folder_path}</span>
                        </span>
                    )}
                    {result.category && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                            {result.category.replace(/_/g, ' ')}
                        </span>
                    )}
                    <span className="shrink-0">{formatSize(result.size_bytes)}</span>
                </div>
            </div>
        </button>
    );
});
