import { Button } from '@/components/ui/button';
import { ProcessingIndicator } from '@/components/ui/ProcessingIndicator';
import { useDocuments } from '@/lib/api';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { OrganizeManual } from './OrganizeManual';

interface OrganizeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function OrganizeModal({ open, onOpenChange }: OrganizeModalProps) {
    const { data: documentsData } = useDocuments({ limit: 100 });
    const documents = documentsData?.items ?? [];

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
                        className={cn('h-full bg-background shadow-2xl', 'md:rounded-2xl md:overflow-hidden')}
                        initial={{ opacity: 0, scale: 0.97, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: 8 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                        <div className="flex h-full flex-col">
                            <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
                                <DialogPrimitive.Title className="text-base font-semibold text-foreground">Organize</DialogPrimitive.Title>
                                <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => onOpenChange(false)} aria-label="Close">
                                    <X className="size-4" />
                                </Button>
                            </div>

                            <ProcessingIndicator
                                documents={documents}
                                variant="banner"
                                className="text-center flex align-center"
                                tooltipText="Your files are being processed. Wait for processing to finish before organising for better results."
                            />

                            <div className="min-h-0 flex-1 overflow-hidden">
                                <OrganizeManual />
                            </div>
                        </div>
                    </motion.div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
