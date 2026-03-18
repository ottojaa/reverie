import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { getExtension } from '@/lib/image-editor';
import { cn } from '@/lib/utils';
import { FlipHorizontal, FlipVertical, Lock, LockOpen, RotateCcw, RotateCw, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import ReactCrop from 'react-image-crop';
import { ImageEditorPanel } from '../ImageEditorPanel';
import type { ViewerProps } from '../viewer-registry';
import { useImageEditState } from './useImageEditState';
import { useImageSave } from './useImageSave';

import 'react-image-crop/dist/ReactCrop.css';

export function ImageEditMode({ document, fileUrl, onToggleEdit }: ViewerProps) {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [optionsOpen, setOptionsOpen] = useState(false);

    const editState = useImageEditState(document, fileUrl, true);
    const { handleSave, isSaving, replaceDocumentFile } = useImageSave(
        document,
        fileUrl,
        editState.completedPercentCropRef,
        editState.crop,
        editState.displayImageSize,
        editState.editorState,
        onToggleEdit,
    );

    const aspect = editState.editorState.maintainAspect ? editState.editorState.aspectRatio : undefined;
    const ext = getExtension(document.original_filename);
    const isSavingAll = isSaving || replaceDocumentFile.isPending;

    const cropArea = (
        <>
            {editState.displayImageSrc ? (
                <ReactCrop
                    crop={editState.crop}
                    onChange={editState.onCropChange}
                    onComplete={editState.onCropComplete}
                    aspect={aspect}
                    ruleOfThirds
                    className="flex max-h-full max-w-full items-center justify-center [&_img]:block [&_img]:max-h-full [&_img]:max-w-full [&_img]:object-contain"
                >
                    <img src={editState.displayImageSrc} alt={document.original_filename} onLoad={editState.onImageLoad} draggable={false} />
                </ReactCrop>
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
            )}
        </>
    );

    if (isDesktop) {
        return (
            <div className="flex h-full w-full flex-col overflow-hidden px-4 pb-4 pt-14 md:px-6 md:pb-6 md:pt-14">
                <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[1fr_380px]">
                    <div className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden p-6">{cropArea}</div>
                    <div className="min-h-0 overflow-y-auto md:overflow-visible">
                        <AnimatePresence>
                            <ImageEditorPanel
                                document={document}
                                state={editState.editorState}
                                onStateChange={editState.handleStateChange}
                                onCancel={() => onToggleEdit?.()}
                                onSave={handleSave}
                                isSaving={isSavingAll}
                            />
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        );
    }

    // Mobile: full-screen image + glass bottom toolbar + options drawer
    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-14">
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">{cropArea}</div>

            {/* Bottom toolbar */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="shrink-0 border-t border-border bg-background/80 backdrop-blur-xl"
            >
                <div className="flex items-center justify-between gap-1 px-3 py-2.5">
                    {/* Quick transform actions */}
                    <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => editState.handleStateChange({ maintainAspect: !editState.editorState.maintainAspect })}
                            title={editState.editorState.maintainAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                            className={cn('text-muted-foreground', editState.editorState.maintainAspect && 'bg-primary/10 text-primary')}
                        >
                            {editState.editorState.maintainAspect ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
                        </Button>

                        <div className="mx-1 h-4 w-px bg-border" />

                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => editState.handleStateChange({ rotation: (editState.editorState.rotation - 90 + 360) % 360 })}
                            title="Rotate left"
                            className="text-muted-foreground"
                        >
                            <RotateCcw className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => editState.handleStateChange({ rotation: (editState.editorState.rotation + 90) % 360 })}
                            title="Rotate right"
                            className="text-muted-foreground"
                        >
                            <RotateCw className="size-4" />
                        </Button>

                        <div className="mx-1 h-4 w-px bg-border" />

                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => editState.handleStateChange({ flipH: !editState.editorState.flipH })}
                            title="Flip horizontal"
                            className={cn('text-muted-foreground', editState.editorState.flipH && 'bg-secondary text-foreground')}
                        >
                            <FlipHorizontal className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => editState.handleStateChange({ flipV: !editState.editorState.flipV })}
                            title="Flip vertical"
                            className={cn('text-muted-foreground', editState.editorState.flipV && 'bg-secondary text-foreground')}
                        >
                            <FlipVertical className="size-4" />
                        </Button>
                    </div>

                    {/* Settings + actions — shrink-0 so they always fit */}
                    <div className="flex shrink-0 items-center gap-1">
                        <div className="mr-0.5 h-4 w-px bg-border" />

                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setOptionsOpen(true)}
                            title="Output options"
                            className="text-muted-foreground"
                        >
                            <SlidersHorizontal className="size-4" />
                        </Button>

                        <div className="mx-0.5 h-4 w-px bg-border" />

                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onToggleEdit?.()}
                            disabled={isSavingAll}
                            className="px-2.5 text-muted-foreground"
                        >
                            Cancel
                        </Button>
                        <Button type="button" size="sm" onClick={handleSave} disabled={isSavingAll} className="px-3">
                            {isSavingAll ? <Spinner className="size-4" /> : 'Save'}
                        </Button>
                    </div>
                </div>
            </motion.div>

            {/* Output options drawer */}
            <Drawer open={optionsOpen} onOpenChange={setOptionsOpen} direction="bottom">
                <DrawerContent className="max-h-[60vh] p-0">
                    <div className="flex flex-col gap-5 p-5 pb-8">
                        <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Output options</p>

                        {/* Quality */}
                        <div className="flex items-center gap-4">
                            <span className="min-w-16 text-sm text-muted-foreground">Quality</span>
                            <Slider
                                value={[editState.editorState.quality]}
                                onValueChange={([v]) => editState.handleStateChange({ quality: v ?? 0.92 })}
                                min={0.1}
                                max={1}
                                step={0.01}
                                className="flex-1"
                            />
                            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                                {Math.round(editState.editorState.quality * 100)}%
                            </span>
                        </div>

                        <Separator />

                        {/* Filename */}
                        <div className="flex items-center gap-3">
                            <span className="min-w-16 shrink-0 text-sm text-muted-foreground">File name</span>
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                <Input
                                    value={editState.editorState.renameValue}
                                    onChange={(e) => editState.handleStateChange({ renameValue: e.target.value })}
                                    className="h-9 min-w-0 flex-1 border-border/80 bg-background/50 text-sm"
                                    placeholder="Filename"
                                />
                                <span className="shrink-0 text-sm text-muted-foreground">{ext}</span>
                            </div>
                        </div>

                        {/* Save as copy */}
                        <div className="flex items-center justify-between gap-4">
                            <label htmlFor="mobile-save-as-copy" className="flex-1 text-sm text-muted-foreground">
                                Save as a copy
                            </label>
                            <Checkbox
                                id="mobile-save-as-copy"
                                checked={editState.editorState.saveAsCopy}
                                onCheckedChange={(checked) => editState.handleStateChange({ saveAsCopy: checked === true })}
                                className="shrink-0"
                            />
                        </div>
                    </div>
                </DrawerContent>
            </Drawer>
        </div>
    );
}
