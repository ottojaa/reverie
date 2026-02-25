import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerProps } from './viewer-registry';

export default function TextViewer({ fileUrl }: ViewerProps) {
    const [content, setContent] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState('');
    const [error, setError] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        setError(null);

        fetch(fileUrl)
            .then((res) => {
                if (!res.ok) throw new Error(`Failed to load (${res.status})`);

                return res.text();
            })
            .then((text) => {
                if (!cancelled) {
                    setContent(text);
                    setEditedContent(text);
                }
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
            });

        return () => {
            cancelled = true;
        };
    }, [fileUrl]);

    const toggleEdit = useCallback(() => {
        setIsEditing((prev) => {
            const next = !prev;

            if (next) {
                requestAnimationFrame(() => textareaRef.current?.focus());
            }

            return next;
        });
    }, []);

    /** Sync gutter scroll with content scroll */
    const handleContentScroll = useCallback(() => {
        if (contentRef.current && gutterRef.current) {
            gutterRef.current.scrollTop = contentRef.current.scrollTop;
        }
    }, []);

    const displayContent = isEditing ? editedContent : content;
    const lineCount = displayContent?.split('\n').length ?? 0;

    if (error) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <div className="rounded-lg bg-card p-8 text-center">
                    <p className="text-sm text-destructive">{error}</p>
                </div>
            </div>
        );
    }

    if (content === null) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
        );
    }

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="flex h-full w-full flex-col">
            {/* Edit toggle bar */}
            <div className="flex items-center justify-between border-b border-border/50 bg-card/50 px-4 py-2 backdrop-blur-sm">
                <span className="text-xs text-muted-foreground">
                    {lineCount} line{lineCount !== 1 ? 's' : ''}
                </span>
                <Button
                    variant={isEditing ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={toggleEdit}
                    className={cn(
                        'text-xs',
                        isEditing && 'bg-primary/10 text-primary hover:bg-primary/15',
                    )}
                >
                    {isEditing ? 'Viewing' : 'Edit'}
                </Button>
            </div>

            {/* Text area with synced line numbers */}
            <div className="relative flex flex-1 overflow-hidden bg-card/30">
                {/* Line numbers gutter — hidden overflow, synced via JS */}
                <div
                    ref={gutterRef}
                    className="flex flex-col overflow-hidden border-r border-border/30 bg-muted/30 px-3 py-4 text-right font-mono text-xs leading-6 text-muted-foreground/50 select-none"
                    aria-hidden
                >
                    {Array.from({ length: lineCount }, (_, i) => (
                        <span key={i}>{i + 1}</span>
                    ))}
                </div>

                {/* Content — this is the only scrollable area */}
                <div ref={contentRef} className="flex-1 overflow-auto" onScroll={handleContentScroll}>
                    {isEditing ? (
                        <Textarea
                            ref={textareaRef}
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            spellCheck={false}
                            className="min-h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-sm leading-6 shadow-none outline-none focus-visible:ring-0"
                        />
                    ) : (
                        <pre className="whitespace-pre-wrap wrap-break-word p-4 font-mono text-sm leading-6 text-foreground">{content}</pre>
                    )}
                </div>
            </div>

            {/* Unsaved changes indicator */}
            {isEditing && editedContent !== content && (
                <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border-t border-border/50 bg-warning/10 px-4 py-2 text-xs text-warning"
                >
                    Unsaved changes — save endpoint not yet connected
                </motion.div>
            )}
        </motion.div>
    );
}
