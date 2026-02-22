'use client';

import { Button } from '@/components/ui/button';
import { iconsData, type SectionIconName } from '@/components/ui/icons-data';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import Fuse from 'fuse.js';
import { DynamicIcon, dynamicIconImports } from 'lucide-react/dynamic';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounceValue } from 'usehooks-ts';

export type IconData = (typeof iconsData)[number];

const ICONS_AVAILABLE: readonly IconData[] = iconsData.filter((icon) => icon.name in dynamicIconImports) as readonly IconData[];

interface IconSelectorProps extends Omit<React.ComponentPropsWithoutRef<typeof PopoverTrigger>, 'onSelect' | 'value'> {
    value?: SectionIconName | null;
    onValueChange?: (name: SectionIconName | null) => void;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    searchPlaceholder?: string;
    triggerPlaceholder?: string;
}

function IconRenderer({ name }: { name: SectionIconName }) {
    const iconName: keyof typeof dynamicIconImports = name in dynamicIconImports ? (name as keyof typeof dynamicIconImports) : 'file-text';

    return <DynamicIcon name={iconName} className="size-5 text-current" />;
}

export function IconSelector({
    value,
    onValueChange,
    open,
    defaultOpen,
    onOpenChange,
    children,
    searchPlaceholder = 'Search icons…',
    triggerPlaceholder = 'No icon',
    ...props
}: IconSelectorProps) {
    const [selectedIcon, setSelectedIcon] = useState<SectionIconName | null>(value ?? null);
    const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
    const [inputValue, setInputValue] = useState('');
    const [search] = useDebounceValue(inputValue, 100);
    const [scrollReady, setScrollReady] = useState(false);
    const isOpenState = open ?? isOpen;

    const fuseInstance = useMemo(
        () =>
            new Fuse(ICONS_AVAILABLE, {
                keys: ['name', 'tags', 'categories'],
                threshold: 0.3,
                ignoreLocation: true,
                includeScore: true,
            }),
        [],
    );

    const filteredIcons = useMemo(() => {
        if (search.trim() === '') return ICONS_AVAILABLE;

        const results = fuseInstance.search(search.trim().toLowerCase());

        return results.map((r) => r.item);
    }, [search, fuseInstance]);

    const categorizedIcons = useMemo(() => {
        if (search.trim() !== '') return [{ name: 'Results', icons: filteredIcons }];

        const categories = new Map<string, IconData[]>();
        filteredIcons.forEach((icon) => {
            const cats = icon.categories?.length ? icon.categories : ['Other'];
            cats.forEach((cat) => {
                if (!categories.has(cat)) categories.set(cat, []);

                categories.get(cat)!.push(icon);
            });
        });

        return Array.from(categories.entries())
            .map(([name, icons]) => ({ name, icons }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [filteredIcons, search]);

    const virtualItems = useMemo(() => {
        const items: Array<{ type: 'category'; categoryIndex: number } | { type: 'row'; categoryIndex: number; rowIndex: number; icons: IconData[] }> = [];
        categorizedIcons.forEach((category, categoryIndex) => {
            items.push({ type: 'category', categoryIndex });

            for (let i = 0; i < category.icons.length; i += 5) {
                items.push({
                    type: 'row',
                    categoryIndex,
                    rowIndex: Math.floor(i / 5),
                    icons: category.icons.slice(i, i + 5),
                });
            }
        });

        return items;
    }, [categorizedIcons]);

    const parentRef = React.useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: virtualItems.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index) => (virtualItems[index]!.type === 'category' ? 28 : 44),
        overscan: 5,
    });

    useEffect(() => {
        if (value !== undefined) setSelectedIcon(value ?? null);
    }, [value]);

    useEffect(() => {
        if (!isOpenState) setScrollReady(false);
    }, [isOpenState]);

    useEffect(() => {
        if (scrollReady) virtualizer.measure();
    }, [scrollReady, virtualizer]);

    const displayValue = value !== undefined ? value : selectedIcon;

    const handleSelect = useCallback(
        (name: SectionIconName) => {
            if (value === undefined) setSelectedIcon(name);

            onValueChange?.(name);
            onOpenChange?.(false);

            if (open === undefined) setIsOpen(false);
        },
        [value, onValueChange, onOpenChange, open],
    );

    const handleClear = useCallback(() => {
        setSelectedIcon(null);
        onValueChange?.(null);
        onOpenChange?.(false);

        if (open === undefined) setIsOpen(false);
    }, [onValueChange, onOpenChange, open]);

    const handleOpenChange = useCallback(
        (next: boolean) => {
            if (open === undefined) setIsOpen(next);

            onOpenChange?.(next);

            if (!next) {
                setInputValue('');
                setScrollReady(false);
            }
        },
        [open, onOpenChange],
    );

    const handleSearchChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            setInputValue(e.target.value);
            parentRef.current && (parentRef.current.scrollTop = 0);
            virtualizer.scrollToOffset(0);
        },
        [virtualizer],
    );

    return (
        <Popover modal open={open ?? isOpen} onOpenChange={handleOpenChange} {...props}>
            <PopoverTrigger asChild>
                {children ?? (
                    <Button type="button" variant="outline" className={cn('h-9 justify-center', displayValue ? 'w-9 p-0' : 'min-w-9 px-3')}>
                        {displayValue ? <IconRenderer name={displayValue} /> : <span className="text-xs text-muted-foreground">{triggerPlaceholder}</span>}
                    </Button>
                )}
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2 relative" align="start">
                <Input placeholder={searchPlaceholder} value={inputValue} onChange={handleSearchChange} className="mb-2 h-8" />
                <div
                    ref={(el) => {
                        (parentRef as React.RefObject<HTMLDivElement | null>).current = el;

                        if (el && isOpenState) requestAnimationFrame(() => setScrollReady(true));
                    }}
                    className="h-60 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-background"
                    style={{ scrollbarWidth: 'thin', WebkitOverflowScrolling: 'touch' }}
                >
                    {filteredIcons.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">No icons found</div>
                    ) : (
                        <div className="w-full" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                            {virtualizer.getVirtualItems().map((virtualItem) => {
                                const item = virtualItems[virtualItem.index];

                                if (!item) return null;

                                const style: React.CSSProperties = {
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualItem.size}px`,
                                    transform: `translateY(${virtualItem.start}px)`,
                                };

                                if (item.type === 'category') {
                                    return (
                                        <div
                                            key={virtualItem.key}
                                            style={style}
                                            className="flex items-center border-b border-border bg-muted/50 px-2 py-1 text-xs font-medium capitalize text-muted-foreground"
                                        >
                                            {categorizedIcons[item.categoryIndex]!.name}
                                        </div>
                                    );
                                }

                                return (
                                    <div key={virtualItem.key} style={style} className="grid grid-cols-5 gap-1 p-1">
                                        {item.icons.map((icon) => (
                                            <button
                                                key={icon.name}
                                                type="button"
                                                title={icon.name}
                                                className={cn(
                                                    'flex items-center justify-center rounded-md border p-2 transition-colors hover:bg-muted',
                                                    displayValue === icon.name && 'border-primary bg-primary/10',
                                                )}
                                                onClick={() => handleSelect(icon.name)}
                                            >
                                                <IconRenderer name={icon.name} />
                                            </button>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                <Button type="button" variant="secondary" className="absolute bottom-2 right-2 h-8" onClick={handleClear}>
                    Clear icon
                </Button>
            </PopoverContent>
        </Popover>
    );
}
