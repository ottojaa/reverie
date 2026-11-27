import type { LockSecretKind } from '@reverie/shared';
import { LockSecretInput } from '../vault/LockSecretInput';
import { PinInput } from '../vault/PinInput';
import { MAX_PASSWORD_LENGTH, type LockSecretDraft } from './lock-secret-draft';

/** A label beside its field, and above it on a narrow screen. */
export function LockField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
    return (
        <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,20rem)] sm:items-center">
            <label htmlFor={id} className="text-sm font-medium">
                {label}
            </label>
            {children}
        </div>
    );
}

interface LockSecretFieldsProps {
    kind: LockSecretKind;
    draft: LockSecretDraft;
    disabled: boolean;
    onChange: (change: Partial<LockSecretDraft>) => void;
}

const FIELDS = [
    { key: 'secret', id: 'lock-new', prefix: 'New' },
    { key: 'repeat', id: 'lock-repeat', prefix: 'Repeat' },
] as const;

/** The new PIN or lock password, typed twice. */
export function LockSecretFields({ kind, draft, disabled, onChange }: LockSecretFieldsProps) {
    return FIELDS.map(({ key, id, prefix }) => (
        <LockField key={key} id={id} label={`${prefix} ${kind === 'pin' ? 'PIN' : 'lock password'}`}>
            {kind === 'pin' ? (
                <PinInput id={id} value={draft[key]} onValueChange={(value) => onChange({ [key]: value })} disabled={disabled} />
            ) : (
                <LockSecretInput
                    id={id}
                    maxLength={MAX_PASSWORD_LENGTH}
                    value={draft[key]}
                    onChange={(event) => onChange({ [key]: event.target.value })}
                    disabled={disabled}
                />
            )}
        </LockField>
    ));
}
