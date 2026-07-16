import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, FolderOpen, Maximize, Minus, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_CAMERA_TUNING, type CameraTuning } from './types.js';

interface UnraveledFolderChip {
    id: string;
    name: string;
    shown: number;
    total: number;
}

interface CanvasOverlayProps {
    onExit: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomToFit: () => void;
    tuning: CameraTuning;
    onTuningChange: (tuning: CameraTuning) => void;
    /** Present only when the user has drag-overrides worth resetting. */
    onResetLayout?: (() => void) | undefined;
    unraveledFolder?: UnraveledFolderChip | null;
}

interface TuningSliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
    hint?: string;
}

function TuningSlider({ label, value, min, max, onChange, hint }: TuningSliderProps) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="tabular-nums text-foreground">{value.toFixed(2)}×</span>
            </div>
            <Slider value={[value]} min={min} max={max} step={0.05} onValueChange={([v]) => v !== undefined && onChange(v)} />
            {hint && <p className="text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
        </div>
    );
}

/** DOM chrome floating above the WebGL canvas. */
export function CanvasOverlay({ onExit, onZoomIn, onZoomOut, onZoomToFit, tuning, onTuningChange, onResetLayout, unraveledFolder }: CanvasOverlayProps) {
    return (
        <div className="pointer-events-none absolute inset-0 z-10">
            <div className="pointer-events-auto absolute left-4 top-4 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onExit} className="gap-1.5 bg-background/80 shadow-sm backdrop-blur">
                    <ArrowLeft className="size-4" aria-hidden />
                    Library
                </Button>
            </div>
            {onResetLayout && (
                <div className="pointer-events-auto absolute right-4 top-4">
                    <Button variant="ghost" size="sm" onClick={onResetLayout} className="gap-1.5 bg-background/60 backdrop-blur">
                        <RotateCcw className="size-4" aria-hidden />
                        Reset layout
                    </Button>
                </div>
            )}
            <div className="pointer-events-auto absolute bottom-6 right-4 flex flex-col gap-1 rounded-md border bg-background/80 p-1 shadow-sm backdrop-blur">
                <Button variant="ghost" size="icon-sm" onClick={onZoomIn} aria-label="Zoom in">
                    <Plus className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={onZoomOut} aria-label="Zoom out">
                    <Minus className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={onZoomToFit} aria-label="Zoom to fit">
                    <Maximize className="size-4" />
                </Button>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Camera settings">
                            <SlidersHorizontal className="size-4" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent side="left" align="end" className="w-60 space-y-4">
                        <p className="text-sm font-medium">Canvas feel</p>
                        <TuningSlider
                            label="Pan speed"
                            value={tuning.panSpeed}
                            min={0.4}
                            max={2.5}
                            onChange={(v) => onTuningChange({ ...tuning, panSpeed: v })}
                        />
                        <TuningSlider
                            label="Zoom speed"
                            value={tuning.zoomSpeed}
                            min={0.4}
                            max={2.5}
                            onChange={(v) => onTuningChange({ ...tuning, zoomSpeed: v })}
                        />
                        <TuningSlider
                            label="Friction"
                            value={tuning.friction}
                            min={0.3}
                            max={2.5}
                            onChange={(v) => onTuningChange({ ...tuning, friction: v })}
                        />
                        <TuningSlider
                            label="Unravel distance"
                            value={tuning.unravelDistance}
                            min={0.5}
                            max={2}
                            onChange={(v) => onTuningChange({ ...tuning, unravelDistance: v })}
                            hint="How far you can zoom out before an open folder gathers back up."
                        />
                        <TuningSlider
                            label="Unravel radius"
                            value={tuning.unravelRadius}
                            min={0.5}
                            max={2}
                            onChange={(v) => onTuningChange({ ...tuning, unravelRadius: v })}
                            hint="How far you can pan off an open folder before it gathers back up."
                        />
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Unravel debug</span>
                            <Switch checked={tuning.debugUnravel} onCheckedChange={(v) => onTuningChange({ ...tuning, debugUnravel: v })} />
                        </div>
                        <Button variant="ghost" size="sm" className="w-full" onClick={() => onTuningChange({ ...DEFAULT_CAMERA_TUNING })}>
                            Reset to defaults
                        </Button>
                    </PopoverContent>
                </Popover>
            </div>
            {unraveledFolder && (
                <div className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2">
                    <Button size="sm" asChild className="gap-1.5 shadow-lg">
                        <Link to="/browse/$sectionId" params={{ sectionId: unraveledFolder.id }}>
                            <FolderOpen className="size-4" aria-hidden />
                            {unraveledFolder.total > unraveledFolder.shown
                                ? `Showing ${unraveledFolder.shown} of ${unraveledFolder.total} — open in Browse`
                                : `Open ${unraveledFolder.name} in Browse`}
                        </Link>
                    </Button>
                </div>
            )}
        </div>
    );
}
