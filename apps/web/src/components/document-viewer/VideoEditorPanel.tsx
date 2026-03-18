import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { getExtension } from '@/lib/image-editor';
import { cn } from '@/lib/utils';
import type { Document } from '@reverie/shared';
import { motion } from 'motion/react';

export interface VideoEditorState {
    renameValue: string;
    saveAsCopy: boolean;
}

interface VideoEditorPanelProps {
    document: Document;
    state: VideoEditorState;
    onStateChange: (updates: Partial<VideoEditorState>) => void;
    onCancel: () => void;
    onSave: () => void;
    isSaving: boolean;
}

const sectionLabelCn = 'text-xs font-semibold uppercase tracking-wider text-foreground';
const rowLabelCn = 'text-sm text-muted-foreground min-w-0';

export function VideoEditorPanel({ document, state, onStateChange, onCancel, onSave, isSaving }: VideoEditorPanelProps) {
    const ext = getExtension(document.original_filename);

    return (
        <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 15 }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            className="flex w-full shrink-0 flex-col gap-6 rounded-md border-l border-border bg-card/95 p-6 backdrop-blur-sm md:w-[380px]"
        >
            <section className="space-y-4">
                <h3 className={sectionLabelCn}>Output options</h3>

                <div className="flex items-center justify-between gap-4">
                    <label htmlFor="video-file-name" className={rowLabelCn}>
                        File name
                    </label>
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                            id="video-file-name"
                            value={state.renameValue}
                            onChange={(e) => onStateChange({ renameValue: e.target.value })}
                            className="h-9 flex-1 min-w-0 border-border/80 bg-background/50 text-sm"
                            placeholder="Filename"
                        />
                        <span className="shrink-0 text-sm text-muted-foreground">{ext}</span>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <label htmlFor="video-save-as-copy" className={cn(rowLabelCn, 'flex-1')}>
                        Save as a copy?
                    </label>
                    <Checkbox
                        id="video-save-as-copy"
                        checked={state.saveAsCopy}
                        onCheckedChange={(checked) => onStateChange({ saveAsCopy: checked === true })}
                        className="shrink-0"
                    />
                </div>
            </section>

            <section className="mt-auto flex gap-3 pt-4">
                <Button variant="destructive" size="sm" onClick={onCancel} disabled={isSaving} className="flex-1">
                    Cancel
                </Button>
                <Button size="sm" onClick={onSave} disabled={isSaving} className="flex-1">
                    {isSaving ? (
                        <span className="flex items-center gap-2">
                            <Spinner className="size-3.5" />
                            Trimming...
                        </span>
                    ) : (
                        'Save'
                    )}
                </Button>
            </section>
        </motion.div>
    );
}

function getBasename(filename: string): string {
    const lastDot = filename.lastIndexOf('.');

    return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

export function getInitialVideoEditorState(document: Document): VideoEditorState {
    return {
        renameValue: getBasename(document.original_filename),
        saveAsCopy: true,
    };
}
