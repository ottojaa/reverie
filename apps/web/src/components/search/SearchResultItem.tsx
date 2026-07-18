import { formatDate, formatFileSize, getThumbnailUrl } from '@/lib/commonhelpers';
import { cn } from '@/lib/utils';
import { formatFilterChip, type SearchResult } from '@reverie/shared';
import { FileText, Folder, Image, Receipt } from 'lucide-react';
import { memo, useRef } from 'react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Chip } from '../ui/chip';
import { ImageLoader } from '../ui/image-loader';

interface SearchResultItemProps {
    result: SearchResult;
    isActive?: boolean;
    compact?: boolean;
    onClick?: () => void;
    /** When set, the containing folder renders as a clickable breadcrumb. */
    onFolderClick?: (folderId: string) => void;
    /** When set, shows a checkbox for multi-select and row click toggles selection instead of calling onClick */
    selected?: boolean;
    onToggle?: (id: string) => void;
}

const LARGE_FILE_BYTES = 10 * 1000 * 1000;
const MAX_ROW_TAGS = 2;

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

function getKindLabel(category: string | null, format: string): string {
    if (category) return formatFilterChip('category', category);

    return format.toUpperCase();
}

function getImmediateFolder(folderPath: string | null): string | null {
    if (!folderPath) return null;

    return folderPath.split('/').filter(Boolean).at(-1) ?? null;
}

/** Backend falls back to the filename as snippet — that's metadata, not content. */
function isFilenameEcho(snippet: string, filename: string): boolean {
    return (
        snippet
            .replace(/<\/?mark>/g, '')
            .trim()
            .toLowerCase() === filename.trim().toLowerCase()
    );
}

export const SearchResultItem = memo(function SearchResultItem({
    result,
    isActive,
    compact,
    onClick,
    onFolderClick,
    selected,
    onToggle,
}: SearchResultItemProps) {
    const thumbRef = useRef<HTMLDivElement>(null);
    const Icon = getCategoryIcon(result.category, result.mime_type);
    const thumbnailUrl = getThumbnailUrl(result, compact ? 'sm' : 'md');
    const displayName = result.display_name;
    const date = result.extracted_date ?? result.uploaded_at;
    const containingFolder = getImmediateFolder(result.folder_path);
    const folderId = result.folder_id;
    const handleFolderClick =
        onFolderClick && folderId
            ? (e: React.MouseEvent) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onFolderClick(folderId);
              }
            : undefined;

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
                'group h-auto flex w-full min-w-0 shrink items-start justify-start gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left hover:bg-secondary/60 dark:hover:bg-secondary/60',
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
                <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-border/50">
                    <ImageLoader
                        ref={thumbRef}
                        hash={result.blurhash ?? ''}
                        url={thumbnailUrl}
                        borderRadius={6}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                </div>
            ) : (
                <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-5 text-muted-foreground" />
                </div>
            )}

            {/* Content */}
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{displayName}</p>

                {result.snippet &&
                    (isFilenameEcho(result.snippet, result.filename) ? (
                        // A filename echo only earns a (demoted, mono) line when it explains the match
                        result.snippet.includes('<mark>') && (
                            <p
                                className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/60 [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                                dangerouslySetInnerHTML={{ __html: result.snippet }}
                            />
                        )
                    ) : (
                        <p
                            className="mt-0.5 line-clamp-2 text-xs text-muted-foreground [&_mark]:bg-primary/20 [&_mark]:text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                            dangerouslySetInnerHTML={{ __html: result.snippet }}
                        />
                    ))}

                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/80">
                    <span className="shrink-0">{getKindLabel(result.category, result.format)}</span>

                    {containingFolder && (
                        <>
                            <span aria-hidden className="text-muted-foreground/40">
                                ·
                            </span>
                            <span
                                title={result.folder_path ?? undefined}
                                onClick={handleFolderClick}
                                className={cn(
                                    'inline-flex min-w-0 items-center gap-1',
                                    handleFolderClick && 'hover:text-foreground hover:underline underline-offset-2',
                                )}
                            >
                                <Folder className="size-3 shrink-0" />
                                <span className="max-w-40 truncate">{containingFolder}</span>
                            </span>
                        </>
                    )}

                    {result.size_bytes > LARGE_FILE_BYTES && (
                        <>
                            <span aria-hidden className="text-muted-foreground/40">
                                ·
                            </span>
                            <span className="shrink-0 tabular-nums">{formatFileSize(result.size_bytes)}</span>
                        </>
                    )}

                    {result.tags.length > 0 && (
                        <span className="ml-auto hidden shrink-0 gap-1 sm:inline-flex">
                            {result.tags.slice(0, MAX_ROW_TAGS).map((tag) => (
                                <Chip key={tag} variant="secondary">
                                    {tag}
                                </Chip>
                            ))}
                        </span>
                    )}
                </div>
            </div>

            {/* Date column — aligned across rows */}
            <div className="w-24 shrink-0 pt-0.5 text-right">
                {!result.extracted_date && <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50">Uploaded</div>}
                <div className="text-[11px] tabular-nums text-muted-foreground/70">{formatDate(date)}</div>
            </div>
        </Button>
    );
});
