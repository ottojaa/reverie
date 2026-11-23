import { BROWSE_LAYOUTS, type BrowseLayout } from '@/lib/browse/browse-layout';
import { cn } from '@/lib/utils';
import { Grid3x3, LayoutGrid, Rows3, type LucideIcon } from 'lucide-react';

const ICONS: Record<BrowseLayout, LucideIcon> = {
    cards: LayoutGrid,
    grid: Grid3x3,
    justified: Rows3,
};

interface BrowseLayoutSwitchProps {
    layout: BrowseLayout;
    onChange: (layout: BrowseLayout) => void;
}

/** Cards / Grid / Justified: how Photos and Videos draw their pictures. A small icon switch next to the tabs. */
export function BrowseLayoutSwitch({ layout, onChange }: BrowseLayoutSwitchProps) {
    return (
        <div role="group" aria-label="Layout" className="inline-flex h-10 items-center gap-0.5 rounded-[10px] bg-muted p-[3px]">
            {BROWSE_LAYOUTS.map(({ layout: value, label }) => {
                const Icon = ICONS[value];
                const isActive = value === layout;

                return (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={isActive}
                        aria-label={label}
                        title={label}
                        onClick={() => onChange(value)}
                        className={cn(
                            'flex h-full w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                            isActive && 'bg-primary/20 text-primary hover:text-primary',
                        )}
                    >
                        <Icon className="size-4" />
                    </button>
                );
            })}
        </div>
    );
}
