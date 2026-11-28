import type { SearchResultView } from '@/routes/search';
import type { SearchHit } from '@reverie/shared';
import { SearchResultsList } from '../results/SearchResultsList';
import { AskAgentLink } from './AskAgentLink';

interface SearchHarderResultsProps {
    results: SearchHit[];
    view: SearchResultView;
    freeText: string;
    onOpenDocument: (id: string) => void;
    onOpenCollection: (id: string) => void;
}

const noNextPage = () => {};

/** What a run found, in the plain results' list or grid: one page, best matches first. */
export function SearchHarderResults({ results, view, freeText, onOpenDocument, onOpenCollection }: SearchHarderResultsProps) {
    return (
        <>
            {results.length === 0 && (
                <p className="mx-auto max-w-md pt-16 text-center text-sm text-muted-foreground">
                    Search harder found nothing for “{freeText}” either. Try describing it with other words.
                </p>
            )}

            <SearchResultsList
                results={results}
                view={view}
                sortBy="relevance"
                isLoading={false}
                hasNextPage={false}
                isFetchingNextPage={false}
                fetchNextPage={noNextPage}
                onOpenDocument={onOpenDocument}
                onOpenCollection={onOpenCollection}
                onFolderClick={onOpenCollection}
            />

            <div className="flex justify-center py-6">
                <AskAgentLink />
            </div>
        </>
    );
}
