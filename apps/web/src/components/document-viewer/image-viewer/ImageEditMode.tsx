import { AnimatePresence } from 'motion/react';
import ReactCrop from 'react-image-crop';
import { ImageEditorPanel } from '../ImageEditorPanel';
import type { ViewerProps } from '../viewer-registry';
import { useImageEditState } from './useImageEditState';
import { useImageSave } from './useImageSave';

import 'react-image-crop/dist/ReactCrop.css';

export function ImageEditMode({ document, fileUrl, onToggleEdit }: ViewerProps) {
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

    return (
        <div className="flex h-full w-full flex-col overflow-hidden px-4 pb-4 pt-14 md:px-6 md:pb-6 md:pt-14">
            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[1fr_380px] gap-4">
                <div className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden p-6">
                    {editState.displayImageSrc ? (
                        <ReactCrop
                            crop={editState.crop}
                            onChange={editState.onCropChange}
                            onComplete={editState.onCropComplete}
                            aspect={aspect}
                            ruleOfThirds
                            className="flex max-h-[calc(100vh-11rem)] max-w-full items-center justify-center [&_img]:block [&_img]:max-h-[calc(100vh-11rem)] [&_img]:max-w-full [&_img]:object-contain"
                        >
                            <img src={editState.displayImageSrc} alt={document.original_filename} onLoad={editState.onImageLoad} draggable={false} />
                        </ReactCrop>
                    ) : (
                        <div className="flex h-full w-full items-center justify-center">
                            <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        </div>
                    )}
                </div>
                <AnimatePresence>
                    <ImageEditorPanel
                        document={document}
                        state={editState.editorState}
                        onStateChange={editState.handleStateChange}
                        onCancel={() => onToggleEdit?.()}
                        onSave={handleSave}
                        isSaving={isSaving || replaceDocumentFile.isPending}
                    />
                </AnimatePresence>
            </div>
        </div>
    );
}
