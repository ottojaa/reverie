import { parseBrowseSearch } from '@/lib/browse/browse-kinds';
import { createFileRoute } from '@tanstack/react-router';
import { BrowsePage } from '../pages/Browse';

export const Route = createFileRoute('/browse/$sectionId')({
    validateSearch: parseBrowseSearch,
    component: BrowseSectionPage,
});

function BrowseSectionPage() {
    const { sectionId } = Route.useParams();
    const { kind } = Route.useSearch();

    return <BrowsePage sectionId={sectionId} kind={kind} />;
}
