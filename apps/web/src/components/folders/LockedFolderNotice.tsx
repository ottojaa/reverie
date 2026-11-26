import { Button } from '@/components/ui/button';
import { useVault } from '@/lib/vault';
import type { LockAsk } from '@reverie/shared';
import { LockKeyhole } from 'lucide-react';

const HOW_TO_OPEN: Record<LockAsk, string> = {
    pin: 'Enter your PIN to open it.',
    password: 'Enter your lock password to open it.',
    account_password: 'Enter your account password to open it.',
};

/** Shown in place of content that sits in a private folder whose lock is closed. */
export function LockedFolderNotice({ onUnlock }: { onUnlock: () => void }) {
    const { ask } = useVault();

    return (
        <div className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent/15 text-accent">
                <LockKeyhole className="size-6" />
            </span>
            <div>
                <p className="text-sm font-medium text-foreground">This folder is locked</p>
                <p className="mt-1 text-xs text-muted-foreground">{ask ? HOW_TO_OPEN[ask] : 'Unlock it to see what is inside.'}</p>
            </div>
            <Button type="button" size="sm" onClick={onUnlock}>
                Unlock
            </Button>
        </div>
    );
}
