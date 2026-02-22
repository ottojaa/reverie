import { useOrganizeChat } from '@/lib/api/organize';
import { cn } from '@/lib/utils';
import type { OrganizeProposalEvent } from '@reverie/shared';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useState } from 'react';
import { OrganizeChat } from './OrganizeChat';
import { OrganizeManual } from './OrganizeManual';
import { OrganizePreview } from './OrganizePreview';

type Mode = 'ai' | 'manual';

interface OrganizeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function OrganizeModal({ open, onOpenChange }: OrganizeModalProps) {
    const [mode, setMode] = useState<Mode>('ai');
    const chatState = useOrganizeChat();

    // Single source of truth: chatState.currentProposal
    const proposal = chatState.currentProposal;

    // Reset state when modal closes
    useEffect(() => {
        if (!open) {
            chatState.reset();
        }
    }, [open]);

    const handleClose = () => onOpenChange(false);

    const handleModeChange = (newMode: Mode) => {
        setMode(newMode);
        chatState.updateProposal(null);

        if (newMode === 'ai') chatState.reset();
    };

    // For manual mode: set proposal directly into chatState
    const handleProposal = (p: OrganizeProposalEvent) => {
        chatState.updateProposal(p);
    };

    const handleProposalChange = (p: OrganizeProposalEvent | null) => {
        chatState.updateProposal(p);
    };

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
                        initial={{ opacity: 0, scale: 0.97, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: 8 }}
                        transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
                    >
                        <div className="flex h-full flex-col md:flex-row">
                            {/* Left panel: chat or manual */}
                            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                                {/* Header */}
                                <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
                                    <span className="text-base font-semibold text-foreground">Organize</span>

                                    {/* Mode toggle */}
                                    <div className="ml-auto flex items-center rounded-lg border border-border bg-secondary p-0.5">
                                        <button
                                            type="button"
                                            onClick={() => handleModeChange('ai')}
                                            className={cn(
                                                'rounded-md px-3 py-1 text-xs font-medium transition-all',
                                                mode === 'ai'
                                                    ? 'bg-background text-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground',
                                            )}
                                        >
                                            AI Assistant
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleModeChange('manual')}
                                            className={cn(
                                                'rounded-md px-3 py-1 text-xs font-medium transition-all',
                                                mode === 'manual'
                                                    ? 'bg-background text-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground',
                                            )}
                                        >
                                            Manual
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleClose}
                                        className="ml-2 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                        aria-label="Close"
                                    >
                                        <X className="size-4" />
                                    </button>
                                </div>

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
                                <OrganizeManual onProposal={handleProposal} />
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
