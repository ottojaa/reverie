import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { getBasename, getExtension } from '@/lib/image-editor';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw } from 'lucide-react';
import { motion } from 'motion/react';
import { Separator } from '../ui/separator';
import { Spinner } from '../ui/spinner';

export interface ImageEditorState {
    maintainAspect: boolean;
    aspectRatio: number;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    quality: number;
    renameValue: string;
    saveAsCopy: boolean;
}

interface ImageEditorPanelProps {
    document: Document;
    state: ImageEditorState;
    onStateChange: (updates: Partial<ImageEditorState>) => void;
    onCancel: () => void;
    onSave: () => void;
    isSaving: boolean;
}

const sectionLabelCn = 'text-xs font-semibold uppercase tracking-wider text-foreground';
const rowLabelCn = 'text-sm text-muted-foreground min-w-0';

export function ImageEditorPanel({ document, state, onStateChange, onCancel, onSave, isSaving }: ImageEditorPanelProps) {
    const ext = getExtension(document.original_filename);

    return (
        <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            className="flex w-[380px] shrink-0 flex-col gap-6 rounded-md border-l border-border bg-card/95 p-6 backdrop-blur-sm"
        >
            {/* Modify */}
            <section className="space-y-4">
                <h3 className={sectionLabelCn}>Modify</h3>

                <div className="flex items-center justify-between gap-4">
                    <label htmlFor="maintain-aspect" className={cn(rowLabelCn, 'flex-1')}>
                        Maintain aspect ratio when cropping
                    </label>
                    <Checkbox
                        id="maintain-aspect"
                        checked={state.maintainAspect}
                        onCheckedChange={(checked) => onStateChange({ maintainAspect: checked === true })}
                        className="shrink-0"
                    />
                </div>

                <div className="flex items-center justify-between gap-4">
                    <span className={rowLabelCn}>Rotate</span>
                    <div className="flex shrink-0 gap-1.5">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                                onStateChange({
                                    rotation: (state.rotation - 90 + 360) % 360,
                                })
                            }
                            title="Rotate left"
                        >
                            <RotateCcw className="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                                onStateChange({
                                    rotation: (state.rotation + 90) % 360,
                                })
                            }
                            title="Rotate right"
                        >
                            <RotateCw className="size-4" />
                        </Button>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <span className={rowLabelCn}>Flip</span>
                    <div className="flex shrink-0 gap-1.5">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onStateChange({ flipH: !state.flipH })}
                            title="Flip horizontal"
                            className={cn(state.flipH && 'bg-secondary')}
                        >
                            <FlipHorizontal className="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onStateChange({ flipV: !state.flipV })}
                            title="Flip vertical"
                            className={cn(state.flipV && 'bg-secondary')}
                        >
                            <FlipVertical className="size-4" />
                        </Button>
                    </div>
                </div>
            </section>

            <Separator />

            {/* Output options */}
            <section className="space-y-4">
                <h3 className={sectionLabelCn}>Output options</h3>

                <div className="flex items-center justify-between gap-4">
                    <span className={rowLabelCn}>Quality</span>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Slider
                            value={[state.quality]}
                            onValueChange={([v]) => onStateChange({ quality: v ?? 0.92 })}
                            min={0.1}
                            max={1}
                            step={0.01}
                            className="flex-1 min-w-20"
                        />
                        <span className="shrink-0 text-xs text-muted-foreground min-w-10">{Math.round(state.quality * 100)}%</span>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <label htmlFor="file-name" className={rowLabelCn}>
                        File name
                    </label>
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                            id="file-name"
                            value={state.renameValue}
                            onChange={(e) => onStateChange({ renameValue: e.target.value })}
                            className="h-9 flex-1 min-w-0 border-border/80 bg-background/50 text-sm"
                            placeholder="Filename"
                        />
                        <span className="shrink-0 text-sm text-muted-foreground">{ext}</span>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <label htmlFor="save-as-copy" className={cn(rowLabelCn, 'flex-1')}>
                        Save as a copy?
                    </label>
                    <Checkbox
                        id="save-as-copy"
                        checked={state.saveAsCopy}
                        onCheckedChange={(checked) => onStateChange({ saveAsCopy: checked === true })}
                        className="shrink-0"
                    />
                </div>
            </section>

            {/* Actions */}
            <section className="mt-auto flex gap-3 pt-4">
                <Button variant="destructive" size="sm" onClick={onCancel} disabled={isSaving} className="flex-1">
                    Cancel
                </Button>
                <Button size="sm" onClick={onSave} disabled={isSaving} className="flex-1">
                    {isSaving ? <Spinner className="size-4" /> : 'Save'}
                </Button>
            </section>
        </motion.div>
    );
}

export function getInitialEditorState(document: Document): ImageEditorState {
    return {
        maintainAspect: false,
        aspectRatio: 1,
        rotation: 0,
        flipH: false,
        flipV: false,
        quality: 1,
        renameValue: getBasename(document.original_filename),
        saveAsCopy: true,
    };
}
