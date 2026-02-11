import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useState } from 'react';

export type ConflictStrategy = 'replace' | 'keep_both';

interface DuplicateOptionsDialogProps {
    title?: string;
    open: boolean;
    duplicateFilenames: string[];
    action: 'upload' | 'move';
    onConfirm: (strategy: ConflictStrategy) => void;
    onCancel: () => void;
}

const REPLACE = 'replace' as const;
const KEEP_BOTH = 'keep_both' as const;

export function DuplicateOptionsDialog({ title = 'Upload options', open, duplicateFilenames, action, onConfirm, onCancel }: DuplicateOptionsDialogProps) {
    const [strategy, setStrategy] = useState<ConflictStrategy>(REPLACE);

    const isSingle = duplicateFilenames.length === 1;
    const firstFilename = duplicateFilenames[0] ?? '';

    const description = isSingle
        ? `${firstFilename} already exists in this location. Do you want to replace the existing file with a new version or keep both files?`
        : 'One or more items already exists in this location. Do you want to replace the existing items with a new version or keep all items?';

    const replaceLabel = isSingle ? 'Replace existing file' : 'Replace existing items';
    const keepLabel = isSingle ? 'Keep both files' : 'Keep all items';
    const primaryButtonLabel = action === 'upload' ? 'Upload' : 'Move';

    const handleConfirm = () => {
        onConfirm(strategy);
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
            <DialogContent showCloseButton={true} className="sm:max-w-md" aria-description="">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <RadioGroup value={strategy} onValueChange={(v) => setStrategy(v as ConflictStrategy)} className="grid gap-3 py-2">
                    <div
                        className="flex items-center gap-2"
                        onClick={() => setStrategy(REPLACE)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && setStrategy(REPLACE)}
                    >
                        <RadioGroupItem value={REPLACE} />
                        <span className="cursor-pointer font-normal">{replaceLabel}</span>
                    </div>
                    <div
                        className="flex items-center gap-2"
                        onClick={() => setStrategy(KEEP_BOTH)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && setStrategy(KEEP_BOTH)}
                    >
                        <RadioGroupItem value={KEEP_BOTH} />
                        <span className="cursor-pointer font-normal">{keepLabel}</span>
                    </div>
                </RadioGroup>
                <DialogFooter className="flex-row justify-end gap-2 sm:justify-end">
                    <Button variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm}>{primaryButtonLabel}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
