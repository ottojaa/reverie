import { useReplaceDocumentFile, useUpdateDocument } from '@/lib/api';
import { applyTransforms, blobToFile, getBasename, getCopyFilename, getExtension, getOutputFormat, percentCropToPixelCrop } from '@/lib/image-editor';
import { uploadFile } from '@/lib/upload/uploadApi';
import type { Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState, type RefObject } from 'react';
import type { Crop, PercentCrop } from 'react-image-crop';
import { toast } from 'sonner';
import type { ImageEditorState } from '../ImageEditorPanel';

function validateCrop(percentCrop: PercentCrop | null, displayImageSize: { width: number; height: number } | null, fileUrl: string | null): boolean {
    if (!percentCrop || !fileUrl || !displayImageSize || percentCrop.width <= 0 || percentCrop.height <= 0) {
        toast.error('Please adjust the crop area');

        return false;
    }

    return true;
}

async function buildSaveFile(
    fileUrl: string,
    percentCrop: PercentCrop,
    displayImageSize: { width: number; height: number },
    editorState: ImageEditorState,
    document: Document,
    mimeType: string,
): Promise<File> {
    const cropArea = percentCropToPixelCrop(percentCrop, displayImageSize.width, displayImageSize.height);

    const blob = await applyTransforms(fileUrl, cropArea, editorState.rotation, editorState.flipH, editorState.flipV, mimeType, editorState.quality);

    const ext = getExtension(document.original_filename);
    const baseName = editorState.renameValue.trim() || getBasename(document.original_filename);
    const currentFilename = ext ? `${baseName}${ext}` : baseName;
    const filename = editorState.saveAsCopy ? getCopyFilename(currentFilename) : currentFilename;

    return blobToFile(blob, filename, mimeType);
}

function getPercentCrop(crop: Crop | undefined): PercentCrop | null {
    if (!crop) return null;

    if (crop.unit === '%') return crop as PercentCrop;

    return null;
}

export function useImageSave(
    document: Document,
    fileUrl: string,
    completedPercentCropRef: RefObject<PercentCrop | null>,
    crop: Crop | undefined,
    displayImageSize: { width: number; height: number } | null,
    editorState: ImageEditorState,
    onToggleEdit?: () => void,
) {
    const [isSaving, setIsSaving] = useState(false);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const updateDocument = useUpdateDocument();
    const replaceDocumentFile = useReplaceDocumentFile();

    const handleSave = useCallback(async () => {
        const percentCrop = completedPercentCropRef.current ?? getPercentCrop(crop);

        if (!validateCrop(percentCrop, displayImageSize, fileUrl)) return;

        if (!percentCrop || !displayImageSize) return;

        const { mimeType } = getOutputFormat(document.original_filename);
        const ext = getExtension(document.original_filename);
        const baseName = editorState.renameValue.trim() || getBasename(document.original_filename);
        const currentFilename = ext ? `${baseName}${ext}` : baseName;

        setIsSaving(true);

        try {
            const file = await buildSaveFile(fileUrl, percentCrop, displayImageSize, editorState, document, mimeType);

            if (editorState.saveAsCopy) {
                if (!document.folder_id) {
                    toast.error('Document must be in a folder to save as copy');
                    setIsSaving(false);

                    return;
                }

                const uploadRes = await uploadFile(file, {
                    folderId: document.folder_id,
                    sessionId: crypto.randomUUID(),
                    conflictStrategy: 'keep_both',
                    copyMetadataFromDocumentId: document.id,
                });

                queryClient.invalidateQueries({ queryKey: ['documents'] });
                queryClient.invalidateQueries({ queryKey: ['sections', 'tree'] });
                toast.success('Saved as copy');
                onToggleEdit?.();
                setIsSaving(false);

                const newDoc = uploadRes.documents[0];

                if (newDoc) navigate({ to: '/document/$id', params: { id: newDoc.id } });
            } else {
                saveInPlace(file, document, currentFilename, updateDocument, replaceDocumentFile, onToggleEdit, setIsSaving);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save image');
            setIsSaving(false);
        }
    }, [
        fileUrl,
        document,
        editorState,
        crop,
        displayImageSize,
        onToggleEdit,
        navigate,
        queryClient,
        replaceDocumentFile,
        updateDocument,
        completedPercentCropRef,
    ]);

    return {
        handleSave,
        isSaving,
        replaceDocumentFile,
    };
}

function saveInPlace(
    file: File,
    document: Document,
    currentFilename: string,
    updateDocument: ReturnType<typeof useUpdateDocument>,
    replaceDocumentFile: ReturnType<typeof useReplaceDocumentFile>,
    onToggleEdit?: () => void,
    setIsSaving?: (v: boolean) => void,
): void {
    const done = () => {
        setIsSaving?.(false);
        toast.success('Saved');
        onToggleEdit?.();
    };

    const nameChanged = currentFilename !== document.original_filename;

    if (!nameChanged) {
        replaceDocumentFile.mutate({ documentId: document.id, file }, { onSuccess: done, onError: () => setIsSaving?.(false) });

        return;
    }

    updateDocument.mutate(
        { documentId: document.id, original_filename: currentFilename },
        {
            onSuccess: () => {
                replaceDocumentFile.mutate({ documentId: document.id, file }, { onSuccess: done, onError: () => setIsSaving?.(false) });
            },
            onError: () => setIsSaving?.(false),
        },
    );
}
