import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ComponentProps, SyntheticEvent } from 'react';

function keepInField(event: SyntheticEvent) {
    event.preventDefault();
}

/**
 * The field for a lock PIN or lock password: masked, but deliberately not `type="password"`. A browser takes any password
 * field for part of this site's login, whatever its `autocomplete` says: it offers to save what was typed and fills the
 * account password in. `one-time-code` keeps the text out of form history and stops Bitwarden reading the word "password"
 * in a label as a login field. What a password field does by itself (no spellcheck, capitals, corrections or copying) is
 * switched on here, except one thing only the form can do: give its form `autoComplete="off"`, or the browser keeps the
 * typed text with the page's history entry, to put back on Back.
 */
export function LockSecretInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type' | 'autoComplete'>) {
    return (
        <Input
            {...props}
            type="text"
            autoComplete="one-time-code"
            data-1p-ignore
            data-bwignore
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onCopy={keepInField}
            onCut={keepInField}
            onDragStart={keepInField}
            className={cn('[-webkit-text-security:disc]', className)}
        />
    );
}
