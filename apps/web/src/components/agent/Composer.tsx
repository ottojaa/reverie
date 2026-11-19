import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';

interface ComposerProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onStop: () => void;
    running: boolean;
    /** Why sending is off (agent not signed in, …); undefined when it is on. */
    disabledReason?: string;
}

/** Enter sends, Shift+Enter adds a line, Escape clears the text or, when it is empty, stops the run. */
export function Composer({ value, onChange, onSubmit, onStop, running, disabledReason }: ComposerProps) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const canSend = value.trim().length > 0 && !running && !disabledReason;

    // Focus again when a run ends so the next question can be typed straight away.
    useEffect(() => {
        if (!running) ref.current?.focus();
    }, [running]);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
            if (value) onChange('');
            else if (running) onStop();

            return;
        }

        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

        event.preventDefault();

        if (canSend) onSubmit();
    };

    return (
        <div className="border-t border-border bg-background px-3 pb-3 pt-3 sm:px-4">
            <div className="mx-auto flex max-w-3xl items-end gap-2">
                <Textarea
                    ref={ref}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={disabledReason ?? 'Ask about your library…'}
                    aria-label="Message the agent"
                    maxLength={8000}
                    rows={1}
                    className="max-h-40 min-h-10 resize-none bg-card"
                />
                {running ? (
                    <Button type="button" size="icon" variant="outline" onClick={onStop} aria-label="Stop the agent">
                        <Square className="size-3.5 fill-current" />
                    </Button>
                ) : (
                    <Button type="button" size="icon" onClick={onSubmit} disabled={!canSend} aria-label="Send message">
                        <ArrowUp className="size-4" />
                    </Button>
                )}
            </div>
        </div>
    );
}
