import { SearchFilterPopover } from '@/components/search/SearchFilterPopover';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useInfiniteSearch } from '@/lib/api/search';
import { useSections } from '@/lib/sections';
import { cn } from '@/lib/utils';
import type { FolderWithChildren, OrganizeOperation, OrganizeProposalEvent, SearchResult } from '@reverie/shared';
import { Check, ChevronDown, ChevronRight, FolderOpen, FolderPlus, Search, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';

interface OrganizeManualProps {
    onProposal: (proposal: OrganizeProposalEvent) => void;
}

function FolderPicker({
    sections,
    selectedId,
    onSelect,
}: {
    sections: FolderWithChildren[];
    selectedId: string | null;
    onSelect: (id: string, name: string, parentId?: string) => void;
}) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(sections.map((s) => s.id)));
    const [showNewForm, setShowNewForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newParentId, setNewParentId] = useState<string | null>(sections[0]?.id ?? null);
    const NEW_FOLDER_SENTINEL = '__new__';

    const toggleCategory = (id: string) => {
        setExpandedCategories((prev) => {
            const next = new Set(prev);

            if (next.has(id)) next.delete(id);
            else next.add(id);

            return next;
        });
    };

    const handleCreate = () => {
        if (!newName.trim() || !newParentId) return;

        onSelect(NEW_FOLDER_SENTINEL, newName.trim(), newParentId);
        setShowNewForm(false);
        setNewName('');
    };

    return (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Move to folder</div>
            <div className="max-h-48 overflow-y-auto">
                {sections.map((category) => (
                    <div key={category.id}>
                        <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary transition-colors"
                            onClick={() => toggleCategory(category.id)}
                        >
                            {expandedCategories.has(category.id) ? (
                                <ChevronDown className="size-3 text-muted-foreground" />
                            ) : (
                                <ChevronRight className="size-3 text-muted-foreground" />
                            )}
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{category.name}</span>
                        </button>
                        {expandedCategories.has(category.id) &&
                            category.children.map((section) => (
                                <button
                                    key={section.id}
                                    type="button"
                                    onClick={() => onSelect(section.id, section.name, category.id)}
                                    className={cn(
                                        'flex w-full items-center gap-2 py-1.5 pl-8 pr-3 text-left text-sm transition-colors',
                                        selectedId === section.id ? 'bg-primary/10 text-primary' : 'hover:bg-secondary text-foreground',
                                    )}
                                >
                                    <FolderOpen className="size-3.5 shrink-0" />
                                    <span className="truncate">{section.name}</span>
                                    {selectedId === section.id && <Check className="ml-auto size-3.5" />}
                                </button>
                            ))}
                    </div>
                ))}
            </div>

            {/* Create new folder */}
            <div className="border-t border-border">
                {showNewForm ? (
                    <div className="p-2 space-y-2">
                        <input
                            autoFocus
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            placeholder="New folder name"
                            className="w-full rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <select
                            value={newParentId ?? ''}
                            onChange={(e) => setNewParentId(e.target.value)}
                            className="w-full rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            {sections.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                    {cat.name}
                                </option>
                            ))}
                        </select>
                        <div className="flex gap-1.5">
                            <Button size="sm" className="flex-1 h-7" onClick={handleCreate} disabled={!newName.trim()}>
                                Create
                            </Button>
                            <Button size="sm" variant="outline" className="h-7" onClick={() => setShowNewForm(false)}>
                                <X className="size-3" />
                            </Button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            onSelect(NEW_FOLDER_SENTINEL, '', undefined);
                            setShowNewForm(true);
                        }}
                        className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                            selectedId === NEW_FOLDER_SENTINEL
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                    >
                        <FolderPlus className="size-3.5" />
                        New folder
                    </button>
                )}
            </div>
        </div>
    );
}

function SearchResultCard({ result, selected, onToggle }: { result: SearchResult; selected: boolean; onToggle: (id: string) => void }) {
    const thumbnailUrl = result.thumbnail_url ? `${import.meta.env.VITE_API_URL}${result.thumbnail_url}` : null;

    return (
        <button
            type="button"
            onClick={() => onToggle(result.document_id)}
            className={cn(
                'group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                selected ? 'bg-primary/5' : 'hover:bg-secondary/60',
            )}
        >
            {/* Checkbox - inline, vertically centered */}
            <div
                className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border transition-all',
                    selected ? 'border-primary bg-primary' : 'border-muted-foreground/30 bg-background group-hover:border-primary/50',
                )}
            >
                {selected && <Check className="size-2.5 text-primary-foreground" />}
            </div>

            {/* Thumbnail */}
            <div className="size-9 shrink-0 overflow-hidden rounded bg-secondary">
                {thumbnailUrl ? (
                    <img src={thumbnailUrl} alt={result.display_name} className="h-full w-full object-cover" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        <span className="text-[9px] font-medium uppercase text-muted-foreground">{result.format}</span>
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium text-foreground">{result.display_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                    {result.folder_path ?? 'No folder'} · {result.format}
                </p>
            </div>
        </button>
    );
}

export function OrganizeManual({ onProposal }: OrganizeManualProps) {
    const [query, setQuery] = useState('');
    const [activeQuery, setActiveQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
    const [targetFolderName, setTargetFolderName] = useState('');
    const [targetParentId, setTargetParentId] = useState<string | undefined>(undefined);
    const [isNewFolder, setIsNewFolder] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const NEW_FOLDER_SENTINEL = '__new__';

    const { data: sectionsData } = useSections();
    const sections = sectionsData ?? [];

    const { data: searchData, isLoading } = useInfiniteSearch({ q: activeQuery, include_facets: true, limit: 30, sort_by: 'uploaded', sort_order: 'desc' });

    const results = useMemo(() => searchData?.pages.flatMap((p) => p.results) ?? [], [searchData]);
    const facets = searchData?.pages[0]?.facets;

    // Auto-search as filters are added/removed
    useEffect(() => {
        setActiveQuery(query);
    }, [query]);

    const addFilter = useCallback((filter: string) => {
        setQuery((q) => (q ? `${q} ${filter}` : filter));
    }, []);

    const removeFilter = useCallback((filter: string) => {
        setQuery((q) => q.replace(filter, '').trim());
    }, []);

    const replaceFilter = useCallback((prefix: string, newValue: string) => {
        const regex = new RegExp(`(?:^|\\s)-?${prefix}:(?:"[^"]+"|\\S+)`, 'g');
        setQuery((q) => q.replace(regex, '').trim() + ` ${newValue}`);
    }, []);

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);

            if (next.has(id)) next.delete(id);
            else next.add(id);

            return next;
        });
    };

    const selectAll = () => {
        setSelectedIds(new Set(results.map((r) => r.document_id)));
    };

    const clearSelection = () => setSelectedIds(new Set());

    const handleFolderSelect = (id: string, name: string, parentId?: string) => {
        if (id === NEW_FOLDER_SENTINEL) {
            setTargetFolderId(id);
            setTargetFolderName(name);
            setTargetParentId(parentId);
            setIsNewFolder(true);
        } else {
            setTargetFolderId(id);
            setTargetFolderName(name);
            setTargetParentId(parentId);
            setIsNewFolder(false);
        }
    };

    const handlePreview = () => {
        const selected = results.filter((r) => selectedIds.has(r.document_id));

        if (selected.length === 0 || !targetFolderName) return;

        const operation: OrganizeOperation = {
            type: isNewFolder ? 'create_and_move' : 'move',
            document_ids: selected.map((r) => r.document_id),
            document_previews: selected.map((r) => ({
                id: r.document_id,
                display_name: r.display_name,
                thumbnail_url: r.thumbnail_url,
                mime_type: r.mime_type,
            })),
            target_folder: {
                id: isNewFolder ? undefined : (targetFolderId ?? undefined),
                name: targetFolderName,
                parent_id: targetParentId,
                is_new: isNewFolder,
            },
        };

        onProposal({
            type: 'proposal',
            summary: `Move ${selected.length} ${selected.length === 1 ? 'document' : 'documents'} to "${targetFolderName}".`,
            operations: [operation],
        });
    };

    const canPreview = selectedIds.size > 0 && targetFolderName.trim().length > 0;
    const hasSelection = selectedIds.size > 0;

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Search bar + filters — sticky header */}
            <div className="shrink-0 border-b border-border px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') setActiveQuery(query);
                            }}
                            placeholder="Filter documents..."
                            className="w-full rounded-lg border border-input bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    </div>
                    <SearchFilterPopover
                        currentQuery={query}
                        facets={facets}
                        onAddFilter={addFilter}
                        onRemoveFilter={removeFilter}
                        onReplaceFilter={replaceFilter}
                    />
                </div>
            </div>

            {/* Scrollable results area */}
            <div className="min-h-0 flex-1 overflow-y-auto">
                {/* Selection count bar */}
                {results.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
                        <span>
                            {results.length} results · {selectedIds.size} selected
                        </span>
                        <div className="flex gap-2">
                            <button type="button" onClick={selectAll} className="hover:text-foreground transition-colors">
                                Select all
                            </button>
                            {selectedIds.size > 0 && (
                                <button type="button" onClick={clearSelection} className="hover:text-foreground transition-colors">
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Results list */}
                {isLoading ? (
                    <div className="py-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                                <Skeleton className="size-4 rounded shrink-0" />
                                <Skeleton className="size-9 rounded shrink-0" />
                                <div className="flex-1 min-w-0 space-y-1">
                                    <Skeleton className="h-3.5 w-3/4" />
                                    <Skeleton className="h-3 w-1/2" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : results.length === 0 && activeQuery ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Search className="size-6 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No documents found</p>
                        <p className="text-xs text-muted-foreground/60">Try different filters</p>
                    </div>
                ) : !activeQuery ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <Search className="size-6 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">Use filters to find documents to organize</p>
                    </div>
                ) : (
                    <div>
                        {results.map((result) => (
                            <SearchResultCard key={result.document_id} result={result} selected={selectedIds.has(result.document_id)} onToggle={toggleSelect} />
                        ))}
                    </div>
                )}
            </div>

            {/* Sticky footer — always visible when items are selected */}
            {hasSelection && sections.length > 0 && (
                <div className="shrink-0 border-t border-border bg-background">
                    <FolderPicker sections={sections} selectedId={targetFolderId} onSelect={handleFolderSelect} />
                    <div className="px-3 py-2.5">
                        <Button onClick={handlePreview} disabled={!canPreview} className="w-full">
                            {canPreview
                                ? `Move ${selectedIds.size} ${selectedIds.size === 1 ? 'document' : 'documents'} to "${targetFolderName}"`
                                : `Select a destination folder (${selectedIds.size} selected)`}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
