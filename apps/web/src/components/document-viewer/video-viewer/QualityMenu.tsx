import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Settings2 } from 'lucide-react';
import { AUTO_QUALITY, type QualityLevel } from './hls-playback';

interface QualityMenuProps {
    levels: QualityLevel[];
    selected: number;
    /** The rung hls.js is playing, shown beside "Auto" so the viewer sees what Auto chose. */
    playingLabel: string | null;
    /** Whether the button shows; the menu keeps it up while open. */
    visible: boolean;
    onSelect: (index: number) => void;
    onOpenChange: (open: boolean) => void;
}

export function QualityMenu({ levels, selected, playingLabel, visible, onSelect, onOpenChange }: QualityMenuProps) {
    const current = levels.find((level) => level.index === selected)?.label;
    const buttonLabel = current ?? (playingLabel ? `Auto · ${playingLabel}` : 'Auto');

    return (
        <DropdownMenu onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={`Video quality: ${buttonLabel}`}
                    className={cn(
                        'absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-border/20 bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition-opacity duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
                    )}
                >
                    <Settings2 className="size-3.5" aria-hidden />
                    {buttonLabel}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
                <DropdownMenuRadioGroup value={String(selected)} onValueChange={(value) => onSelect(Number(value))}>
                    <DropdownMenuRadioItem value={String(AUTO_QUALITY)}>Auto</DropdownMenuRadioItem>
                    {levels.map((level) => (
                        <DropdownMenuRadioItem key={level.index} value={String(level.index)}>
                            {level.label}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
