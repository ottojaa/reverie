import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { SearchSortBy, SearchSortOrder } from '@/routes/search';
import { ArrowDownAZ, ArrowUpAZ, Calendar, Check, ChevronDown, Clock, FileText, Star } from 'lucide-react';

const sortOptions: Array<{ value: SearchSortBy; label: string; icon: typeof Star }> = [
    { value: 'relevance', label: 'Relevance', icon: Star },
    { value: 'uploaded', label: 'Upload date', icon: Clock },
    { value: 'date', label: 'Document date', icon: Calendar },
    { value: 'filename', label: 'Filename', icon: ArrowDownAZ },
    { value: 'size', label: 'Size', icon: FileText },
];

interface SortMenuProps {
    sortBy: SearchSortBy;
    sortOrder: SearchSortOrder;
    /** Picking the sort already in use flips its order. */
    onSort: (sortBy: SearchSortBy) => void;
}

export function SortMenu({ sortBy, sortOrder, onSort }: SortMenuProps) {
    const activeSortOption = sortOptions.find((o) => o.value === sortBy);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary"
                >
                    {activeSortOption && <activeSortOption.icon className="size-3.5" />}
                    {activeSortOption?.label ?? 'Sort'}
                    {sortOrder === 'asc' ? <ArrowUpAZ className="size-3" /> : <ChevronDown className="size-3" />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                {sortOptions.map((option) => (
                    <DropdownMenuItem key={option.value} onClick={() => onSort(option.value)} className={cn(sortBy === option.value && 'font-medium')}>
                        <option.icon className="size-3.5" />
                        {option.label}
                        {sortBy === option.value && <Check className="ml-auto size-3.5 text-primary" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
