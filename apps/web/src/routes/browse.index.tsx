import { parseBrowseSearch } from '@/lib/browse/browse-kinds';
import { createFileRoute } from '@tanstack/react-router';
import { BrowsePage } from '../pages/Browse';

export const Route = createFileRoute('/browse/')({
    validateSearch: parseBrowseSearch,
    component: BrowseLibraryPage,
});

function BrowseLibraryPage() {
    const { kind } = Route.useSearch();

    return <BrowsePage kind={kind} />;
}
