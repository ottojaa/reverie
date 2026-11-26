import { BrowseDashboard } from '@/components/documents/BrowseDashboard';
import { BrowseKindView } from '@/components/documents/BrowseKindView';
import { useIsFolderGone } from '@/lib/folders/gone';
import type { DocumentKind } from '@reverie/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export interface BrowsePageProps {
    sectionId?: string;
    /** Set: that kind's own view. Not set: the dashboard. */
    kind?: DocumentKind | undefined;
}

/** A folder trashed from somewhere else, or an old link to one, has no page: go to the top of the library. */
function useLeaveGoneFolder(sectionId: string | undefined) {
    const navigate = useNavigate();
    const isGone = useIsFolderGone(sectionId);

    useEffect(() => {
        if (isGone) void navigate({ to: '/browse', replace: true });
    }, [isGone, navigate]);
}

export function BrowsePage({ sectionId, kind }: BrowsePageProps) {
    useLeaveGoneFolder(sectionId);

    if (kind) return <BrowseKindView kind={kind} sectionId={sectionId} />;

    return <BrowseDashboard sectionId={sectionId} />;
}
