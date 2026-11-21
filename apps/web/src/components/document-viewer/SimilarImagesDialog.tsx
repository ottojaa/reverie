import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSimilarImages } from '@/lib/api/search';
import { getThumbnailUrl } from '@/lib/commonhelpers';
import { useNavigate } from '@tanstack/react-router';

interface SimilarImagesDialogProps {
    documentId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const SIMILAR_IMAGES_LIMIT = 24;

/** The images in the library that look most like this one, nearest first. */
export function SimilarImagesDialog({ documentId, open, onOpenChange }: SimilarImagesDialogProps) {
    const navigate = useNavigate();
    const { data, isLoading, isError } = useSimilarImages(documentId, SIMILAR_IMAGES_LIMIT, open);
    const results = data?.results ?? [];

    function openImage(id: string) {
        onOpenChange(false);
        navigate({ to: '/document/$id', params: { id } });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Similar images</DialogTitle>
                    <DialogDescription>Images in your library that look like this one, closest first.</DialogDescription>
                </DialogHeader>

                {isLoading && (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                )}

                {isError && <p className="py-8 text-center text-sm text-muted-foreground">Couldn’t load similar images. Try again in a moment.</p>}

                {!isLoading && !isError && results.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">No similar images yet. This image may still be getting analysed.</p>
                )}

                {results.length > 0 && (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                        {results.map((result) => {
                            const thumbnail = getThumbnailUrl(result, 'md');

                            return (
                                <li key={result.document_id} className="min-w-0">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => openImage(result.document_id)}
                                        className="group h-auto w-full flex-col items-stretch gap-1.5 p-1.5 text-left"
                                    >
                                        <div className="aspect-square overflow-hidden rounded-md bg-muted ring-1 ring-border/50">
                                            {thumbnail && <img src={thumbnail} alt={result.display_name} loading="lazy" className="size-full object-cover" />}
                                        </div>
                                        <span className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
                                            <span className="truncate font-medium">{result.display_name}</span>
                                            {result.relevance !== null && (
                                                <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(result.relevance * 100)}%</span>
                                            )}
                                        </span>
                                    </Button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </DialogContent>
        </Dialog>
    );
}
