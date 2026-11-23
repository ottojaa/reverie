import { Button } from '@/components/ui/button';
import { ProcessingIndicator } from '@/components/ui/ProcessingIndicator';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { useSectionEdit } from '@/lib/SectionEditContext';
import { useProcessingDocuments } from '@/lib/api';
import type { FolderWithChildren } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { Map, Pencil } from 'lucide-react';
import { hasLayoutChoice, type BrowseLayout } from '@/lib/browse/browse-layout';
import type { BrowseTab } from '@/lib/browse/browse-tabs';
import { BrowseLayoutSwitch } from './BrowseLayoutSwitch';
import { BrowseTabList } from './BrowseKindTabs';

interface BrowseHeaderProps {
    /** The open folder, or null for the whole library. */
    section: FolderWithChildren | null;
    sectionId: string | undefined;
    subtitle: string | null;
    isLoading: boolean;
    tab: BrowseTab;
    layout: BrowseLayout;
    onLayoutChange: (layout: BrowseLayout) => void;
}

/** Title and count on the left; the folder's actions and the All / Photos / Videos / Files switch on the right. */
export function BrowseHeader({ section, sectionId, subtitle, isLoading, tab, layout, onLayoutChange }: BrowseHeaderProps) {
    const { openEdit } = useSectionEdit();

    return (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
                <h1 className="flex items-center gap-2 text-2xl font-semibold">
                    {section?.emoji && <SectionIcon value={section.emoji} className="size-7" />}
                    {section ? section.name : 'My Files'}
                </h1>
                {section?.description && <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>}
                <p className="mt-1 min-h-5 text-sm text-primary">{subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                {sectionId && (
                    <>
                        <FolderProcessingBadge folderId={sectionId} visible={!isLoading} />
                        <Button variant="outline" size="sm" className="shrink-0" asChild>
                            <Link to="/canvas" search={{ focus: sectionId }} preload="intent">
                                <Map className="mr-2 size-4" />
                                Canvas
                            </Link>
                        </Button>
                        {section && (
                            <Button variant="outline" size="sm" className="shrink-0" onClick={() => openEdit(section)}>
                                <Pencil className="mr-2 size-4" />
                                Edit folder
                            </Button>
                        )}
                    </>
                )}
                {hasLayoutChoice(tab) && <BrowseLayoutSwitch layout={layout} onChange={onLayoutChange} />}
                <BrowseTabList />
            </div>
        </div>
    );
}

/**
 * The folder's processing spinner. It asks the server for the folder's still-processing documents of every
 * kind, so it shows whichever tab is open; a finished job refreshes the list and the spinner goes with it.
 */
function FolderProcessingBadge({ folderId, visible }: { folderId: string; visible: boolean }) {
    const { data } = useProcessingDocuments(folderId);

    return <ProcessingIndicator documents={data?.items ?? []} variant="badge" visible={visible} />;
}
