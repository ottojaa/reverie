import { createFullCrop, getOutputFormat, renderTransformedImage } from '@/lib/image-editor';
import type { Document } from '@reverie/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Crop, PercentCrop, PixelCrop } from 'react-image-crop';
import { getInitialEditorState, type ImageEditorState } from '../ImageEditorPanel';

export function useImageEditState(document: Document, fileUrl: string, isEditMode: boolean) {
    const [editorState, setEditorState] = useState<ImageEditorState>(() => getInitialEditorState(document));
    const [crop, setCrop] = useState<Crop | undefined>(undefined);
    const [displayImageSrc, setDisplayImageSrc] = useState<string | null>(null);
    const [displayImageSize, setDisplayImageSize] = useState<{ width: number; height: number } | null>(null);
    const completedCropRef = useRef<PixelCrop | null>(null);
    const completedPercentCropRef = useRef<PercentCrop | null>(null);

    // Regenerate display image when rotation/flip changes
    useEffect(() => {
        if (!isEditMode || !fileUrl) return;

        const { mimeType } = getOutputFormat(document.original_filename);
        let revoked = false;

        renderTransformedImage(fileUrl, editorState.rotation, editorState.flipH, editorState.flipV, mimeType, editorState.quality)
            .then((url) => {
                if (revoked) {
                    URL.revokeObjectURL(url);

                    return;
                }

                setCrop(undefined);
                setDisplayImageSize(null);
                setDisplayImageSrc((prev) => {
                    if (prev) URL.revokeObjectURL(prev);

                    return url;
                });
            })
            .catch(() => {});

        return () => {
            revoked = true;
        };
    }, [isEditMode, fileUrl, document.original_filename, editorState.rotation, editorState.flipH, editorState.flipV]);

    // Reset edit state when exiting or document changes
    useEffect(() => {
        setDisplayImageSrc((prev) => {
            if (prev) URL.revokeObjectURL(prev);

            return null;
        });

        if (isEditMode) {
            setEditorState(getInitialEditorState(document));
            setCrop(undefined);
            setDisplayImageSize(null);
            completedCropRef.current = null;
            completedPercentCropRef.current = null;
        }
    }, [isEditMode, document.id, document]);

    const onImageLoad = useCallback(
        (e: React.SyntheticEvent<HTMLImageElement>) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            const aspectRatio = naturalWidth / naturalHeight;
            setDisplayImageSize({ width: naturalWidth, height: naturalHeight });
            setEditorState((s) => ({ ...s, aspectRatio }));

            const aspect = editorState.maintainAspect ? aspectRatio : undefined;

            setCrop(createFullCrop(naturalWidth, naturalHeight, aspect));
        },
        [editorState.maintainAspect],
    );

    const onCropChange = useCallback(
        (pixelCrop: PixelCrop, percentCrop: PercentCrop) => {
            setCrop(editorState.maintainAspect ? percentCrop : pixelCrop);
            completedCropRef.current = pixelCrop;
            completedPercentCropRef.current = percentCrop;
        },
        [editorState.maintainAspect],
    );

    const onCropComplete = useCallback((pixelCrop: PixelCrop, percentCrop: PercentCrop) => {
        completedCropRef.current = pixelCrop;
        completedPercentCropRef.current = percentCrop;
    }, []);

    const handleStateChange = useCallback(
        (updates: Partial<ImageEditorState>) => {
            setEditorState((s) => ({ ...s, ...updates }));

            if (updates.maintainAspect !== undefined && displayImageSize) {
                const { width, height } = displayImageSize;
                const newAspect = updates.maintainAspect ? width / height : undefined;

                setCrop(createFullCrop(width, height, newAspect));
            }
        },
        [displayImageSize],
    );

    return {
        editorState,
        setEditorState,
        crop,
        setCrop,
        displayImageSrc,
        displayImageSize,
        completedCropRef,
        completedPercentCropRef,
        onImageLoad,
        onCropChange,
        onCropComplete,
        handleStateChange,
    };
}
