import { formatDateRange } from '@reverie/shared';
import { Calendar } from 'lucide-react';
import { useState } from 'react';
import { DateFilterPanel, type DateFieldKey, type DateFieldState } from './DateFilterPanel';
import { PillPopover } from './PillPopover';

interface DateFilterPillProps extends DateFieldState {
    isRead: boolean;
    onSetValue: (key: DateFieldKey, value: string) => void;
    onClearField: (key: DateFieldKey) => void;
    /** Clears both date fields in a single navigation (two sequential clears would race). */
    onClearAll: () => void;
}

function dateLabel({ uploadedValue, dateValue }: DateFieldState): string {
    if (!uploadedValue && !dateValue) return 'Date';

    const primary = uploadedValue ? `Uploaded: ${formatDateRange(uploadedValue)}` : `Doc date: ${formatDateRange(dateValue ?? '')}`;

    return uploadedValue && dateValue ? `${primary} +1` : primary;
}

/** The single Date pill covering both date fields (uploaded / document date). */
export function DateFilterPill({ uploadedValue, dateValue, isRead, onSetValue, onClearField, onClearAll }: DateFilterPillProps) {
    const [open, setOpen] = useState(false);
    const isActive = uploadedValue !== null || dateValue !== null;

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            icon={Calendar}
            label={dateLabel({ uploadedValue, dateValue })}
            isActive={isActive}
            isRead={isRead}
            clearLabel="Clear date filters"
            onClear={onClearAll}
        >
            <DateFilterPanel uploadedValue={uploadedValue} dateValue={dateValue} onSetValue={onSetValue} onClear={onClearField} onDone={() => setOpen(false)} />
        </PillPopover>
    );
}
