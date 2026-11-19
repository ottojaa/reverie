import type { CreateApiTokenResponse } from '@reverie/shared';
import { Check, Copy } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { API_BASE } from '../../lib/api/client';

/** The line the owner pastes into a terminal to connect Claude Code to this server. */
export function toConnectCommand(secret: string): string {
    return `claude mcp add --transport http reverie ${API_BASE}/mcp --header "Authorization: Bearer ${secret}"`;
}

function CopyBlock({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard access can be refused; the text is selectable, so nothing is lost.
            setCopied(false);
        }
    };

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{label}</span>
                <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? 'Copied' : 'Copy'}
                </Button>
            </div>
            <code className="block max-h-32 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all select-all">{value}</code>
        </div>
    );
}

interface NewTokenDialogProps {
    created: CreateApiTokenResponse | null;
    onClose: () => void;
    /** Where focus goes when the dialog closes; the dialog has no trigger element to return it to. */
    returnFocusTo?: RefObject<HTMLElement | null>;
}

/** Shows a freshly minted secret. It is held only in the parent's state and is gone once this closes. */
export function NewTokenDialog({ created, onClose, returnFocusTo }: NewTokenDialogProps) {
    return (
        <Dialog open={created !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className="sm:max-w-2xl"
                onCloseAutoFocus={(event) => {
                    if (!returnFocusTo?.current) return;

                    event.preventDefault();
                    returnFocusTo.current.focus();
                }}
            >
                {created && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Token “{created.token.name}” created</DialogTitle>
                            <DialogDescription>Copy it now. For your security it is shown only once and cannot be retrieved later.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 min-w-0">
                            <CopyBlock label="Token" value={created.secret} />
                            <CopyBlock label="Connect Claude Code" value={toConnectCommand(created.secret)} />
                        </div>
                        <DialogFooter>
                            <Button type="button" onClick={onClose}>
                                I’ve copied it
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
