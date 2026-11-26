import { Button } from '@/components/ui/button';
import { ProcessingIndicator } from '@/components/ui/ProcessingIndicator';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { useSectionEdit } from '@/lib/SectionEditContext';
import { useProcessingDocuments } from '@/lib/api';
import type { FolderWithChildren } from '@reverie/shared';
import { Link } from '@tanstack/react-router';
import { Map, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

interface BrowseHeaderProps {
    /** The open folder, or null for the whole library. */
    section: FolderWithChildren | null;
    /** Replaces the folder's name as the title (a kind view is titled by its kind). */
    title?: string;
    /** The folder was refused as locked. One inside a locked folder has no `section` to name it. */
    isLocked?: boolean;
    subtitle: string | null;
    /** Leads the title (the kind view's back arrow). */
    back?: ReactNode;
    /** The right-hand side: the folder's actions, or the layout switch. */
    children?: ReactNode;
}

/** Title and subtitle on the left, whatever the view offers on the right. */
export function BrowseHeader({ section, title, isLocked, subtitle, back, children }: BrowseHeaderProps) {
    return (
        <div className="mb-1 flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
                {back}
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-[28px] font-semibold leading-[34px] tracking-tight">
                        {!title && section?.emoji && <SectionIcon value={section.emoji} className="size-7" />}
                        {title ?? section?.name ?? (isLocked ? 'Locked folder' : 'My Files')}
                    </h1>
                    {!title && section?.description && <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>}
                    <p className="mt-0.5 min-h-5 text-sm text-primary">{subtitle}</p>
                </div>
            </div>
            {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
        </div>
    );
}

/** A folder's own buttons: its processing spinner, the canvas, and editing it. */
export function FolderActions({ section, folderId, isLoading }: { section: FolderWithChildren | null; folderId: string; isLoading: boolean }) {
    const { openEdit } = useSectionEdit();

    return (
        <>
            <FolderProcessingBadge folderId={folderId} visible={!isLoading} />
            <Button variant="outline" size="sm" className="shrink-0" asChild>
                <Link to="/canvas" search={{ focus: folderId }} preload="intent">
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
    );
}

/**
 * The folder's processing spinner. It asks the server for the folder's still-processing documents of every
 * kind; a finished job refreshes the lists and the spinner goes with it.
 */
function FolderProcessingBadge({ folderId, visible }: { folderId: string; visible: boolean }) {
    const { data } = useProcessingDocuments(folderId);

    return <ProcessingIndicator documents={data?.items ?? []} variant="badge" visible={visible} />;
}
