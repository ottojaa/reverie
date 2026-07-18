import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatDateRange } from '@reverie/shared';
import { Calendar as CalendarIcon, Check } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { DateRange } from 'react-day-picker';

export type DateFieldKey = 'uploaded' | 'date';

export interface DateFieldState {
    uploadedValue: string | null;
    dateValue: string | null;
}

interface DateFilterPanelProps extends DateFieldState {
    onSetValue: (key: DateFieldKey, value: string) => void;
    onClear: (key: DateFieldKey) => void;
    /** Called after a preset/range is committed (closes the pill popover). */
    onDone?: () => void;
}

const DATE_FIELDS: Array<{ key: DateFieldKey; label: string; hint: string }> = [
    { key: 'uploaded', label: 'Uploaded', hint: 'When the file was added to Reverie' },
    { key: 'date', label: 'Document date', hint: 'The main date on the document itself — like the issue date on a receipt or letter' },
];

const DATE_PRESETS = [
    { label: 'This week', value: 'last-week' },
    { label: 'This month', value: 'last-month' },
    { label: 'This year', value: 'last-year' },
    { label: 'Last year', value: `${new Date().getFullYear() - 1}` },
];

function formatDateISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    return `${y}-${m}-${d}`;
}

/**
 * One date panel for both date fields: pick which date you mean (uploaded vs
 * the date written in the document), then a preset or a custom range.
 * Single-value radio semantics per field.
 */
export function DateFilterPanel({ uploadedValue, dateValue, onSetValue, onClear, onDone }: DateFilterPanelProps) {
    const [field, setField] = useState<DateFieldKey>(dateValue && !uploadedValue ? 'date' : 'uploaded');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    const activeField = DATE_FIELDS.find((f) => f.key === field) ?? DATE_FIELDS[0]!;
    const activeValue = field === 'uploaded' ? uploadedValue : dateValue;

    const handlePreset = useCallback(
        (value: string) => {
            setCalendarOpen(false);

            if (activeValue === value) {
                onClear(field);

                return;
            }

            onSetValue(field, value);
            onDone?.();
        },
        [activeValue, field, onClear, onSetValue, onDone],
    );

    const handleRangeSelect = useCallback(
        (range: DateRange | undefined) => {
            setDateRange(range);

            if (!range?.from || !range?.to) return;

            onSetValue(field, `${formatDateISO(range.from)}..${formatDateISO(range.to)}`);
            setCalendarOpen(false);
            onDone?.();
        },
        [field, onSetValue, onDone],
    );

    const isCustomActive = Boolean(activeValue?.includes('..'));

    return (
        <div className="flex flex-col">
            <div className="px-3 pb-1 pt-2.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Date</span>
            </div>

            {/* Which date? */}
            <div className="px-2 pb-1">
                <div className="flex rounded-md border border-border/60 p-0.5">
                    {DATE_FIELDS.map((f) => {
                        const isSelected = field === f.key;
                        const hasValue = (f.key === 'uploaded' ? uploadedValue : dateValue) !== null;

                        return (
                            <Button
                                key={f.key}
                                type="button"
                                variant="ghost"
                                onClick={() => setField(f.key)}
                                className={cn(
                                    'h-6 flex-1 gap-1 rounded-[5px] px-2 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground dark:hover:bg-secondary',
                                    isSelected && 'bg-secondary text-foreground',
                                )}
                            >
                                {f.label}
                                {hasValue && <span className="size-1 rounded-full bg-primary" />}
                            </Button>
                        );
                    })}
                </div>
                <p className="px-1 pb-0.5 pt-1.5 text-[11px] leading-relaxed text-muted-foreground/70">{activeField.hint}</p>
            </div>

            <div className="p-1">
                {DATE_PRESETS.map((preset) => {
                    const isActive = activeValue === preset.value;

                    return (
                        <Button
                            key={preset.value}
                            type="button"
                            variant="ghost"
                            onClick={() => handlePreset(preset.value)}
                            className={cn(
                                'h-auto w-full justify-start gap-2.5 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-secondary dark:hover:bg-secondary',
                                isActive && 'bg-primary/5',
                            )}
                        >
                            <span
                                className={cn(
                                    'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                                    isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                                )}
                            >
                                {isActive && <Check className="size-2.5" />}
                            </span>
                            <span className="flex-1 text-left">{preset.label}</span>
                        </Button>
                    );
                })}

                <div className="mx-2 my-1 border-t border-border/40" />

                {/* Custom range — nested Popover so the calendar floats independently */}
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            className={cn(
                                'h-auto w-full justify-start gap-2.5 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-secondary dark:hover:bg-secondary',
                                (calendarOpen || isCustomActive) && 'bg-primary/5',
                            )}
                        >
                            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 text-left">Custom range</span>
                            {isCustomActive && activeValue && <span className="text-xs text-primary">{formatDateRange(activeValue)}</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent side="right" align="center" className="w-auto p-2">
                        <Calendar mode="range" selected={dateRange} onSelect={handleRangeSelect} numberOfMonths={2} />
                        {isCustomActive && (
                            <div className="mt-2 flex items-center justify-end border-t border-border/40 px-2 pt-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setDateRange(undefined);
                                        setCalendarOpen(false);
                                        onClear(field);
                                    }}
                                    className="h-auto py-0 text-xs text-muted-foreground"
                                >
                                    Clear
                                </Button>
                            </div>
                        )}
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}
