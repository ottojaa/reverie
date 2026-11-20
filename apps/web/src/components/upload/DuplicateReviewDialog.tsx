import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatFileSize } from '@/lib/commonhelpers';
import { describeContent, describeNameConflict, needsConflictChoice, type ReviewItem } from '@/lib/upload/duplicateReview';
import { cn } from '@/lib/utils';
import type { ContentLocation } from '@reverie/shared';
import { Copy, FileWarning, Lock, Trash2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { ConflictStrategy } from './DuplicateOptionsDialog';

interface DuplicateReviewDialogProps {
    items: ReviewItem[];
    /** Queued files the check had nothing to say about: they upload whatever is decided here. */
    cleanCount: number;
    folderName?: string;
    /** `skipIds` leave the queue; `strategy` is set only when some uploaded file has a same-name file in the folder. */
    onConfirm: (skipIds: string[], strategy: ConflictStrategy | undefined) => void;
    onCancel: () => void;
}

const contentIcons: Record<ContentLocation['where'], LucideIcon> = { folder: Copy, private: Lock, trash: Trash2 };

function SkipChoice({ skip, onChange, name }: { skip: boolean; onChange: (skip: boolean) => void; name: string }) {
    return (
        <div role="group" aria-label={`What to do with ${name}`} className="flex shrink-0 gap-1 rounded-lg bg-muted p-0.5">
            <Button size="sm" variant={skip ? 'secondary' : 'ghost'} aria-pressed={skip} className={cn(skip && 'shadow-xs')} onClick={() => onChange(true)}>
                Skip
            </Button>
            <Button size="sm" variant={skip ? 'ghost' : 'secondary'} aria-pressed={!skip} className={cn(!skip && 'shadow-xs')} onClick={() => onChange(false)}>
                Upload anyway
            </Button>
        </div>
    );
}

function ReviewRow({ item, skip, folderName, onChange }: { item: ReviewItem; skip: boolean; folderName?: string; onChange: (skip: boolean) => void }) {
    const { content, name_conflict } = item.result;
    const found = content ? describeContent(content, item.name) : null;
    const Icon = content ? contentIcons[content.where] : FileWarning;

    return (
        <li className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <Icon className={cn('mt-0.5 size-5 shrink-0', content ? 'text-primary' : 'text-warning')} aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={item.name}>
                        {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(item.size)}</p>
                    {found && (
                        <p className="mt-1 text-sm break-words">
                            {found.label}
                            {found.detail && <span className="text-muted-foreground"> · {found.detail}</span>}
                        </p>
                    )}
                    {name_conflict && <p className="mt-1 text-sm break-words text-warning">{describeNameConflict(folderName, content !== null)}</p>}
                </div>
            </div>
            {content && <SkipChoice skip={skip} onChange={onChange} name={item.name} />}
        </li>
    );
}

function ConflictChoice({ strategy, onChange }: { strategy: ConflictStrategy; onChange: (strategy: ConflictStrategy) => void }) {
    return (
        <RadioGroup value={strategy} onValueChange={(value) => onChange(value as ConflictStrategy)} className="gap-2 border-t pt-3" aria-label="Same name">
            <p className="text-sm text-muted-foreground">For files whose name is already taken:</p>
            <div className="flex items-center gap-2">
                <RadioGroupItem value="replace" id="conflict-replace" />
                <label htmlFor="conflict-replace" className="cursor-pointer text-sm">
                    Replace the existing file (it goes to Trash)
                </label>
            </div>
            <div className="flex items-center gap-2">
                <RadioGroupItem value="keep_both" id="conflict-keep-both" />
                <label htmlFor="conflict-keep-both" className="cursor-pointer text-sm">
                    Keep both files
                </label>
            </div>
        </RadioGroup>
    );
}

function confirmLabel(uploadCount: number): string {
    if (uploadCount === 0) return 'Skip all';

    return `Upload ${uploadCount} ${uploadCount === 1 ? 'file' : 'files'}`;
}

export function DuplicateReviewDialog({ items, cleanCount, folderName, onConfirm, onCancel }: DuplicateReviewDialogProps) {
    const [uploadAnyway, setUploadAnyway] = useState<ReadonlySet<string>>(new Set());
    const [strategy, setStrategy] = useState<ConflictStrategy>('replace');

    const contentItems = items.filter((item) => item.result.content);
    const isSkipped = (item: ReviewItem) => item.result.content !== null && !uploadAnyway.has(item.fileId);
    const skipIds = items.filter(isSkipped).map((item) => item.fileId);
    const uploadCount = cleanCount + items.length - skipIds.length;
    const askStrategy = items.some((item) => needsConflictChoice(item, uploadAnyway.has(item.fileId)));

    const setSkip = (fileId: string, skip: boolean) =>
        setUploadAnyway((current) => {
            const next = new Set(current);

            if (skip) next.delete(fileId);
            else next.add(fileId);

            return next;
        });

    return (
        <Dialog open onOpenChange={(open) => !open && onCancel()}>
            <DialogContent showCloseButton className="flex max-h-[85vh] w-full flex-col max-md:h-full max-md:max-h-none max-md:rounded-none sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{contentItems.length > 0 ? 'Some of these are already in your library' : 'Some names are already taken'}</DialogTitle>
                    <DialogDescription>
                        {contentItems.length > 0
                            ? 'Skipped files are removed from this upload. You can still upload any of them.'
                            : 'Choose what happens to files whose name is already in this folder.'}
                    </DialogDescription>
                </DialogHeader>

                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {items.map((item) => (
                        <ReviewRow
                            key={item.fileId}
                            item={item}
                            skip={isSkipped(item)}
                            folderName={folderName}
                            onChange={(skip) => setSkip(item.fileId, skip)}
                        />
                    ))}
                </ul>

                {askStrategy && <ConflictChoice strategy={strategy} onChange={setStrategy} />}

                <DialogFooter className="flex-row justify-end gap-2 sm:justify-end">
                    <Button variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button onClick={() => onConfirm(skipIds, askStrategy ? strategy : undefined)}>{confirmLabel(uploadCount)}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
