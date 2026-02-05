import { createFileRoute } from '@tanstack/react-router';
import { BrowsePage } from '../pages/Browse';

export const Route = createFileRoute('/browse/$sectionId')({
    component: BrowseSectionPage,
});

function BrowseSectionPage() {
    const { sectionId } = Route.useParams();
    return <BrowsePage sectionId={sectionId} />;
}