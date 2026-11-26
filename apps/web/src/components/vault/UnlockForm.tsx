import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LockAsk } from '@reverie/shared';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PIN_LENGTH, PinInput } from './PinInput';

interface UnlockFormProps {
    ask: LockAsk;
    /** The line about the last refused try; it goes as soon as typing starts again. */
    error: string | null;
    /** Shakes the form as it appears, for one that replaces a refused try. */
    isRetry: boolean;
    isPending: boolean;
    onEdit: () => void;
    onSubmit: (typed: string) => void;
    onCancel: () => void;
    onForgot: () => void;
}

const SHAKE = { x: [0, -8, 8, -6, 6, -3, 3, 0] };

/** One try at a lock: the field for what `ask` names. A PIN submits itself on its fourth digit. */
export function UnlockForm({ ask, error, isRetry, isPending, onEdit, onSubmit, onCancel, onForgot }: UnlockFormProps) {
    const [typed, setTyped] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const isPin = ask === 'pin';

    useEffect(() => inputRef.current?.focus(), []);

    const edit = (next: string) => {
        setTyped(next);
        onEdit();

        if (isPin && next.length === PIN_LENGTH && typed.length < PIN_LENGTH) onSubmit(next);
    };

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();

        if (!isPin && typed) onSubmit(typed);
    };

    return (
        <motion.form animate={isRetry ? SHAKE : undefined} transition={{ duration: 0.4 }} onSubmit={handleSubmit} className="flex flex-col gap-3">
            {isPin ? (
                <div className="flex justify-center">
                    <PinInput ref={inputRef} aria-label="PIN" value={typed} onValueChange={edit} readOnly={isPending} aria-invalid={!!error} />
                </div>
            ) : (
                <Input
                    ref={inputRef}
                    type="password"
                    autoComplete={ask === 'account_password' ? 'current-password' : 'off'}
                    placeholder={ask === 'account_password' ? 'Account password' : 'Lock password'}
                    aria-label={ask === 'account_password' ? 'Account password' : 'Lock password'}
                    value={typed}
                    onChange={(event) => edit(event.target.value)}
                    aria-invalid={!!error}
                />
            )}
            {error && (
                <p role="alert" className={isPin ? 'text-center text-sm text-destructive' : 'text-sm text-destructive'}>
                    {error}
                </p>
            )}
            <div className="flex items-center justify-between gap-2">
                {ask === 'account_password' ? (
                    <span />
                ) : (
                    <Button type="button" variant="link" className="px-0" onClick={onForgot}>
                        Forgot it?
                    </Button>
                )}
                <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    {!isPin && (
                        <Button type="submit" disabled={!typed || isPending}>
                            {isPending ? 'Unlocking…' : 'Unlock'}
                        </Button>
                    )}
                </div>
            </div>
        </motion.form>
    );
}
