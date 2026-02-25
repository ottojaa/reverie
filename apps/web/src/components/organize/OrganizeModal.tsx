import { Button } from '@/components/ui/button';
import { MinimizedPill } from '@/components/ui/MinimizedPill';
import { ProcessingIndicator } from '@/components/ui/ProcessingIndicator';
import { useDocuments } from '@/lib/api';
import { useOrganizeChatContext } from '@/lib/api/OrganizeChatContext';
import { cn } from '@/lib/utils';
import type { OrganizeProposalEvent } from '@reverie/shared';
import { Minimize2, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OrganizeChat } from './OrganizeChat';
import { OrganizeManual } from './OrganizeManual';
import { OrganizePreview } from './OrganizePreview';

type Mode = 'ai' | 'manual';

interface OrganizeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isMinimized: boolean;
    setIsMinimized: (minimized: boolean) => void;
}

export function OrganizeModal({ open, onOpenChange, isMinimized, setIsMinimized }: OrganizeModalProps) {
    const [mode, setMode] = useState<Mode>('ai');
    const [isMinimizing, setIsMinimizing] = useState(false);
    const chatState = useOrganizeChatContext();

    const { data: documentsData } = useDocuments({ limit: 100 });
    const documents = documentsData?.items ?? [];

    // Single source of truth: chatState.currentProposal
    const proposal = chatState.currentProposal;

    // Reset state when modal closes (not when minimizing)
    useEffect(() => {
        if (!open) {
            chatState.reset();
            chatState.setInput('');
            setIsMinimized(false);
            setIsMinimizing(false);
        }
    }, [open, setIsMinimized, chatState.reset, chatState.setInput]);

    const handleClose = () => onOpenChange(false);

    const minimizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleMinimize = () => {
        setIsMinimizing(true);
        minimizeTimeoutRef.current = setTimeout(() => {
            setIsMinimizing(false);
            setIsMinimized(true);
            minimizeTimeoutRef.current = null;
        }, 280);
    };

    useEffect(() => {
        return () => {
            if (minimizeTimeoutRef.current) clearTimeout(minimizeTimeoutRef.current);
        };
    }, []);

    const handleRestore = () => setIsMinimized(false);

    const handleModeChange = (newMode: Mode) => {
        setMode(newMode);
        chatState.updateProposal(null);

        if (newMode === 'ai') chatState.reset();
    };

    const handleProposalChange = (p: OrganizeProposalEvent | null) => {
        chatState.updateProposal(p);
    };

    // Minimized: show floating pill only
    if (open && isMinimized) {
        return createPortal(
            <AnimatePresence>
                <MinimizedPill
                    icon={<Sparkles />}
                    label="Organize"
                    subtitle={chatState.messages.length > 0 ? `${chatState.messages.length} messages` : 'AI assistant'}
                    onClick={handleRestore}
                    onClose={handleClose}
                    className="right-[calc(3.5rem+2rem)]"
                />
            </AnimatePresence>,
            document.body,
        );
    }

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay asChild>
                    <motion.div
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    />
                </DialogPrimitive.Overlay>

                <DialogPrimitive.Content className="fixed inset-0 z-50 outline-none md:inset-4">
                    <motion.div
                        className={cn(
                            'h-full bg-background shadow-2xl',
                            // Desktop: floating with rounded corners
                            'md:rounded-2xl md:overflow-hidden',
                        )}
                        style={{ transformOrigin: '100% 100%' }}
                        initial={{ opacity: 0, scale: 0.97, y: 8 }}
                        animate={isMinimizing ? { opacity: 0, scale: 0.3, y: 40 } : { opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: 8 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                        <div className="flex h-full flex-col md:flex-row">
                            {/* Left panel: chat or manual */}
                            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                                {/* Header */}
                                <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
                                    <span className="text-base font-semibold text-foreground">Organize</span>

                                    {/* Mode toggle */}
                                    <div className="ml-auto flex items-center rounded-lg border border-border bg-secondary p-0.5">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className={cn(
                                                'h-7 rounded-md px-3 text-xs font-medium',
                                                mode === 'ai' ? 'bg-background text-foreground shadow-sm hover:bg-background' : 'text-muted-foreground',
                                            )}
                                            onClick={() => handleModeChange('ai')}
                                        >
                                            AI Assistant
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className={cn(
                                                'h-7 rounded-md px-3 text-xs font-medium',
                                                mode === 'manual' ? 'bg-background text-foreground shadow-sm hover:bg-background' : 'text-muted-foreground',
                                            )}
                                            onClick={() => handleModeChange('manual')}
                                        >
                                            Manual
                                        </Button>
                                    </div>

                                    <Button variant="ghost" size="icon-sm" onClick={handleMinimize} aria-label="Minimize">
                                        <Minimize2 className="size-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon-sm" onClick={handleClose} aria-label="Close">
                                        <X className="size-4" />
                                    </Button>
                                </div>

                                <ProcessingIndicator
                                    documents={documents}
                                    variant="banner"
                                    className="text-center flex align-center"
                                    tooltipText="Your files are being processed. Wait for processing to finish before organising for better results."
                                />

                                {/* Content */}
                                <div className="min-h-0 flex-1 overflow-hidden">
                                    <AnimatePresence mode="wait">
                                        {mode === 'ai' ? (
                                            <motion.div
                                                key="ai"
                                                className="h-full"
                                                initial={{ opacity: 0, x: -8 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, x: -8 }}
                                                transition={{ duration: 0.15 }}
                                            >
                                                <OrganizeChat chatState={chatState} />
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key="manual"
                                                className="h-full"
                                                initial={{ opacity: 0, x: 8 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, x: 8 }}
                                                transition={{ duration: 0.15 }}
                                            >
                                                <OrganizeManual />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            {/* Right panel: proposal preview */}
                            <AnimatePresence>
                                {proposal && (
                                    <motion.div
                                        className={cn(
                                            'flex flex-col overflow-hidden border-border bg-background',
                                            // Mobile: slide up from bottom
                                            'fixed inset-x-0 bottom-0 z-10 max-h-[60vh] rounded-t-2xl border-t shadow-xl',
                                            // Desktop: right side panel
                                            'md:relative md:inset-auto md:max-h-none md:w-96 md:shrink-0 md:rounded-none md:border-l md:shadow-none',
                                        )}
                                        initial={{ opacity: 0, x: 20, y: 0 }}
                                        animate={{ opacity: 1, x: 0, y: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }}
                                    >
                                        <OrganizePreview proposal={proposal} onProposalChange={handleProposalChange} onClose={handleClose} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
