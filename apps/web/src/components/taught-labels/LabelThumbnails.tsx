import { Button } from '@/components/ui/button';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import type { DocumentSearchResult } from '@reverie/shared';
import { X } from 'lucide-react';

interface LabelThumbnailsProps {
    title: string;
    description?: string;
    documents: DocumentSearchResult[];
    /** Total behind `documents` when only a page is shown. */
    total?: number;
    emptyText: string;
    removeLabel: (document: DocumentSearchResult) => string;
    onRemove: (document: DocumentSearchResult) => void;
    onOpen: (document: DocumentSearchResult) => void;
    disabled?: boolean;
}

/** A labelled grid of image thumbnails, each with a remove button. */
export function LabelThumbnails({ title, description, documents, total, emptyText, removeLabel, onRemove, onOpen, disabled }: LabelThumbnailsProps) {
    const hiddenCount = (total ?? documents.length) - documents.length;

    return (
        <section className="space-y-2">
            <div>
                <h3 className="text-sm font-medium">
                    {title} <span className="font-normal text-muted-foreground tabular-nums">{total ?? documents.length}</span>
                </h3>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
            {documents.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">{emptyText}</p>
            ) : (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {documents.map((document) => {
                        const thumbnail = getThumbnailUrl(document, 'sm');

                        return (
                            <li key={document.document_id} className="group relative min-w-0">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => onOpen(document)}
                                    title={document.display_name}
                                    className="h-auto w-full flex-col items-stretch gap-1 p-1 text-left"
                                >
                                    <div className="aspect-square overflow-hidden rounded-md bg-muted ring-1 ring-border/50">
                                        {thumbnail && <img src={thumbnail} alt="" loading="lazy" className="size-full object-cover" />}
                                    </div>
                                    <span className="truncate text-[11px]">{document.display_name}</span>
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon-sm"
                                    disabled={disabled}
                                    onClick={() => onRemove(document)}
                                    aria-label={removeLabel(document)}
                                    title={removeLabel(document)}
                                    className="absolute top-1.5 right-1.5 size-6 opacity-0 shadow-sm group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                                >
                                    <X className="size-3.5" />
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}
            {hiddenCount > 0 && (
                <p className="text-xs text-muted-foreground">Showing the first {documents.length}. Raise the threshold to see fewer, closer matches.</p>
            )}
        </section>
    );
}
