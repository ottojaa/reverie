import { FolderPadlock } from '@/components/folders/FolderPadlock';
import { SectionIcon } from '@/components/ui/SectionIcon';
import { toTotalCount } from '@/lib/folders/tree.js';
import type { FolderWithChildren } from '@reverie/shared';
import { Link } from '@tanstack/react-router';

/** The folders directly inside the open one, each a link to its own page. A locked one asks for the password there. */
export function SubfolderList({ folders }: { folders: FolderWithChildren[] }) {
    if (folders.length === 0) return null;

    return (
        <section aria-label="Folders">
            <h2 className="mb-2.5 mt-5 text-lg font-semibold">Folders</h2>
            <ul className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/50">
                {folders.map((folder) => (
                    <li key={folder.id}>
                        <SubfolderRow folder={folder} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

function SubfolderRow({ folder }: { folder: FolderWithChildren }) {
    const count = toTotalCount(folder);

    return (
        <Link
            to="/browse/$sectionId"
            params={{ sectionId: folder.id }}
            className="flex items-center gap-3 px-3 py-2.5 text-sm outline-none transition-colors hover:bg-secondary/60 focus-visible:bg-secondary"
        >
            <SectionIcon value={folder.emoji || 'folder'} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={folder.name}>
                {folder.name}
            </span>
            {!folder.locked && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {count} {count === 1 ? 'file' : 'files'}
                </span>
            )}
            <FolderPadlock folder={folder} />
        </Link>
    );
}
