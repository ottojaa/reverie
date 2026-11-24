import type { ReactNode, Ref } from 'react';

const MIN_WIDTH = 640;

interface TableShellProps {
    columns: string;
    /** Add the Folder column: only the library-wide view needs it, inside a folder every row is in that folder. */
    showFolder: boolean;
    bodyRef: Ref<HTMLDivElement>;
    /** The height of all the rows, so the page scrolls as if every row were drawn. */
    bodyHeight: number;
    children: ReactNode;
}

/** The frame the document tables share: the header (Name, Folder, Size, Added) over a body the rows are positioned in. */
export function TableShell({ columns, showFolder, bodyRef, bodyHeight, children }: TableShellProps) {
    return (
        <div className="overflow-x-auto rounded-xl bg-card">
            <div style={{ minWidth: MIN_WIDTH }}>
                <div
                    className="grid items-center gap-4 px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    style={{ gridTemplateColumns: columns }}
                >
                    <span>Name</span>
                    {showFolder && <span>Folder</span>}
                    <span className="text-right">Size</span>
                    <span className="text-foreground">Added ↓</span>
                </div>
                <div ref={bodyRef} className="relative" style={{ height: bodyHeight }}>
                    {children}
                </div>
            </div>
        </div>
    );
}

/** The grid template of a table's rows, header included, so the columns line up. */
export function tableColumns(showFolder: boolean): string {
    return showFolder ? 'minmax(0, 1fr) 160px 96px 160px' : 'minmax(0, 1fr) 96px 160px';
}
