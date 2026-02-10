import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { FileTypeIcon, getFileExtension, getFileTypeConfig } from '@/components/ui/FileTypeIcon';
import { useDeleteDocuments } from '@/lib/api/documents';
import { useConfirm } from '@/lib/confirm';
import { useSelectionOptional } from '@/lib/selection';
import { cn } from '@/lib/utils';
import { useDraggable } from '@dnd-kit/core';
import type { Document } from '@reverie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { Loader2, Play, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';

const DOUBLE_TAP_MS = 400;

interface DocumentCardProps {
    document: Document;
    /** Ordered list of document ids (e.g. from grid); required for shift+click range selection */
    orderedIds?: string[];
    className?: string;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
    const date = new Date(dateString);

    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

/**
 * Get thumbnail URL for a document (uses pre-signed URLs from API)
 */
function getThumbnailUrl(document: Document, size: 'sm' | 'md' | 'lg' = 'md'): string | null {
    // Use pre-signed URLs from the API response
    if (document.thumbnail_urls) {
        const url = document.thumbnail_urls[size];

        if (url) {
            // Signed URLs are relative, prepend API base
            const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

            return `${API_BASE}${url}`;
        }
    }

    return null;
}

export function DocumentCard({ document, orderedIds = [], className }: DocumentCardProps) {
    const selection = useSelectionOptional();
    const confirm = useConfirm();
    const deleteDocuments = useDeleteDocuments();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const lastTapRef = useRef<{ id: string; time: number } | null>(null);
    const isSelected = selection?.isSelected(document.id) ?? false;
    const selectedIds = selection?.selectedIds ?? new Set<string>();

    // When dragging a selected card, drag all selected documents
    // When dragging an unselected card, drag just that one
    const documentIds = isSelected ? Array.from(selectedIds) : [document.id];

    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `doc-${document.id}`,
        data: {
            type: 'documents' as const,
            documentIds,
        },
    });

    const isProcessing = document.ocr_status === 'processing' || document.thumbnail_status === 'processing';
    const isPending = document.ocr_status === 'pending' || document.thumbnail_status === 'pending';
    const hasThumbnail = document.thumbnail_urls && document.thumbnail_status === 'complete';

    const fileConfig = getFileTypeConfig(document.mime_type);
    const extension = getFileExtension(document.original_filename);
    const thumbnailUrl = getThumbnailUrl(document);

    const handleClick = (e: React.MouseEvent) => {
        const isSimpleClick = !e.shiftKey && !e.metaKey && !e.ctrlKey;

        if (isSimpleClick) {
            const now = Date.now();
            const prev = lastTapRef.current;

            if (prev?.id === document.id && now - prev.time < DOUBLE_TAP_MS) {
                lastTapRef.current = null;
                e.preventDefault();
                e.stopPropagation();
                queryClient.setQueryData(['document', document.id], document);
                navigate({ to: '/document/$id', params: { id: document.id } });

                return;
            }

            lastTapRef.current = { id: document.id, time: now };
        }

        if (!selection) return;

        if (e.shiftKey) {
            e.preventDefault();
            const anchor = selection.anchorId;

            if (anchor != null && orderedIds.length > 0) {
                selection.selectRange(anchor, document.id, orderedIds);
            } else {
                selection.selectOnly(document.id);
            }
        } else if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            selection.toggle(document.id);
        } else {
            e.preventDefault();
            selection.selectOnly(document.id);
        }
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        // Seed the single-document query cache so the viewer loads instantly
        queryClient.setQueryData(['document', document.id], document);
        navigate({ to: '/document/$id', params: { id: document.id } });
    };

    const handleDelete = async () => {
        const confirmed = await confirm({
            title: 'Delete document?',
            description: 'This action cannot be undone.',
            confirmText: 'Delete',
            variant: 'destructive',
        });

        if (confirmed) deleteDocuments.mutate([document.id]);
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div ref={setNodeRef} style={{ touchAction: 'none' }} {...attributes} {...listeners}>
                    <Link to="/document/$id" params={{ id: document.id }} onClick={handleClick} onDoubleClick={handleDoubleClick} draggable={false}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: isDragging ? 0.5 : 1, scale: isDragging ? 0.98 : 1 }}
                            whileHover={isDragging ? {} : { scale: 1.02, y: -2 }}
                            transition={{ duration: 0.2 }}
                            className={cn(
                                'group relative overflow-hidden rounded-md bg-card transition-shadow',
                                'border border-border/50 shadow-md hover:shadow-lg',
                                'dark:border-border dark:shadow-none dark:hover:shadow-none',
                                isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background dark:ring-offset-background',
                                isDragging && 'cursor-grabbing',
                                className,
                            )}
                        >
                            {isSelected && (
                                <div className="z-10 pointer-events-none absolute inset-0 rounded-md bg-primary/12 dark:bg-primary/15" aria-hidden />
                            )}
                            {/* Thumbnail / Icon area */}
                            <div className="relative aspect-4/3 overflow-hidden bg-muted">
                                {hasThumbnail && thumbnailUrl ? (
                                    <>
                                        {/* Blurhash placeholder */}
                                        {document.thumbnail_blurhash && (
                                            <div
                                                className="absolute inset-0 bg-cover bg-center"
                                                style={{
                                                    // Blurhash would be decoded here with a library
                                                    // For now, use a gradient as placeholder
                                                    background: `linear-gradient(135deg, ${fileConfig.bgColor}, ${fileConfig.bgColor})`,
                                                }}
                                            />
                                        )}
                                        {/* Actual thumbnail */}
                                        <img
                                            src={thumbnailUrl}
                                            alt={document.original_filename}
                                            className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
                                            loading="lazy"
                                        />
                                        {/* Play icon overlay for videos */}
                                        {document.mime_type.startsWith('video/') && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                                <div className="rounded-full bg-white/90 p-3 shadow-md dark:bg-black/40">
                                                    <Play className="size-8 text-foreground fill-foreground" />
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    /* File type icon for non-thumbnail files */
                                    <div className={cn('flex h-full w-full items-center justify-center', fileConfig.bgColor)}>
                                        <FileTypeIcon mimeType={document.mime_type} size="xl" className="opacity-80" />
                                    </div>
                                )}

                                {/* File extension badge */}
                                {extension && (
                                    <div className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white backdrop-blur-sm">
                                        .{extension.toLowerCase()}
                                    </div>
                                )}

                                {/* Processing overlay */}
                                {(isProcessing || isPending) && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
                                    >
                                        <motion.div
                                            animate={isProcessing ? { rotate: 360 } : {}}
                                            transition={isProcessing ? { duration: 2, repeat: Infinity, ease: 'linear' } : {}}
                                        >
                                            <Loader2 className={cn('size-8 text-white', isProcessing && 'animate-spin')} />
                                        </motion.div>
                                        <span className="absolute bottom-2 left-2 text-xs font-medium text-white">
                                            {isProcessing ? 'Processing...' : 'Pending...'}
                                        </span>
                                    </motion.div>
                                )}
                            </div>

                            {/* File info */}
                            <div className="p-3">
                                <p className="truncate text-sm font-medium" title={document.original_filename}>
                                    {document.original_filename}
                                </p>
                                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{formatFileSize(document.size_bytes)}</span>
                                    <span>•</span>
                                    <span>{formatDate(document.created_at)}</span>
                                </div>
                            </div>
                        </motion.div>
                    </Link>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem variant="destructive" onSelect={handleDelete}>
                    <Trash2 className="size-4" />
                    Delete
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
