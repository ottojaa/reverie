import { BrowseDashboard } from '@/components/documents/BrowseDashboard';
import { BrowseKindView } from '@/components/documents/BrowseKindView';
import type { DocumentKind } from '@reverie/shared';

export interface BrowsePageProps {
    sectionId?: string;
    /** Set: that kind's own view. Not set: the dashboard. */
    kind?: DocumentKind | undefined;
}

export function BrowsePage({ sectionId, kind }: BrowsePageProps) {
    if (kind) return <BrowseKindView kind={kind} sectionId={sectionId} />;

    return <BrowseDashboard sectionId={sectionId} />;
}
