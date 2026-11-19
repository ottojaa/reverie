import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { adminApi } from '@/lib/api/admin';
import { getApiErrorMessage } from '@/lib/api/client';
import type { ServerSetting } from '@reverie/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';

type Draft = string | boolean;

function toDraft(value: unknown): Draft {
    if (typeof value === 'boolean') return value;

    return String(value ?? '');
}

// The input kind follows the default's type: number, boolean, or text. A blank number field is
// sent as null so the server, not the form, says what is wrong with it.
function toValue(draft: Draft, kind: string): unknown {
    if (kind === 'number') return draft === '' ? null : Number(draft);

    return draft;
}

function formatValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function SettingInput({
    id,
    kind,
    draft,
    disabled,
    invalid,
    onChange,
}: {
    id: string;
    kind: string;
    draft: Draft;
    disabled: boolean;
    invalid: boolean;
    onChange: (draft: Draft) => void;
}) {
    if (typeof draft === 'boolean') {
        return <Switch id={id} checked={draft} disabled={disabled} onCheckedChange={onChange} />;
    }

    return (
        <Input
            id={id}
            type={kind === 'number' ? 'number' : 'text'}
            inputMode={kind === 'number' ? 'numeric' : undefined}
            value={draft}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={invalid ? id + '-error' : undefined}
            className="w-full sm:w-40"
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

/**
 * One editable server setting. The parent keys this component on the setting's current value, so
 * the draft is re-seeded after a save or a reset instead of drifting from what the server holds.
 */
export function ServerSettingRow({ setting }: { setting: ServerSetting }) {
    const queryClient = useQueryClient();
    const initial = toDraft(setting.value);
    const [draft, setDraft] = useState<Draft>(initial);
    const [error, setError] = useState<string | null>(null);
    const kind = typeof setting.default;
    const inputId = 'setting-' + setting.key;

    const onSettled = () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });

    const save = useMutation({
        mutationFn: () => adminApi.updateSetting(setting.key, { value: toValue(draft, kind) }),
        onSuccess: () => {
            toast.success('Setting saved');

            return onSettled();
        },
        onError: (err) => setError(getApiErrorMessage(err, 'Failed to save setting')),
    });

    const reset = useMutation({
        mutationFn: () => adminApi.resetSetting(setting.key),
        onSuccess: () => {
            toast.success('Reset to default');

            return onSettled();
        },
        onError: (err) => setError(getApiErrorMessage(err, 'Failed to reset setting')),
    });

    const isBusy = save.isPending || reset.isPending;
    const isDirty = draft !== initial;

    const handleChange = (next: Draft) => {
        setDraft(next);
        setError(null);
    };

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();

        if (!isDirty || isBusy) return;

        setError(null);
        save.mutate();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;

        handleChange(initial);
    };

    return (
        // noValidate: the server's message is the one validation voice, not the browser's number-input bubble.
        <form noValidate onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={inputId} className="font-mono text-sm font-medium">
                        {setting.key}
                    </label>
                    {setting.overridden && <Badge variant="secondary">Overridden</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{setting.description}</p>
                <p className="text-xs text-muted-foreground">Default: {formatValue(setting.default)}</p>
            </div>

            <div className="flex shrink-0 flex-col gap-2 md:items-end">
                <div className="flex flex-wrap items-center gap-2">
                    <SettingInput id={inputId} kind={kind} draft={draft} disabled={isBusy} invalid={error !== null} onChange={handleChange} />
                    <Button type="submit" disabled={!isDirty || isBusy}>
                        {save.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    <Button type="button" variant="outline" disabled={!setting.overridden || isBusy} onClick={() => reset.mutate()}>
                        Reset to default
                    </Button>
                </div>
                {error && (
                    <p id={inputId + '-error'} role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                )}
            </div>
        </form>
    );
}
