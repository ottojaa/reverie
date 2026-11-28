import { Button } from '@/components/ui/button';
import type { SearchHarderState } from '@/lib/hooks/useSearchHarder';
import { Loader2, Sparkles } from 'lucide-react';

interface SearchHarderActionProps {
    harder: SearchHarderState;
    /** Typed text is still on its way into the search: a run now would be for the old words. */
    isTyping: boolean;
}

/** The offer under the plain results, its working state, and what went wrong with the last run. */
export function SearchHarderAction({ harder, isTyping }: SearchHarderActionProps) {
    const { isRunning, errorMessage, isUnavailable, run } = harder;

    return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
            {errorMessage && (
                <p role="alert" className="max-w-md text-sm text-destructive">
                    {errorMessage}
                </p>
            )}

            {!isUnavailable && (
                <>
                    <p aria-live="polite" className="text-sm text-muted-foreground">
                        {isRunning ? 'Trying other words for it. This can take a few seconds.' : "Can't find it?"}
                    </p>
                    {/* aria-disabled while running keeps the keyboard focus on the button */}
                    <Button
                        type="button"
                        variant="outline"
                        onClick={isRunning ? undefined : run}
                        disabled={isTyping}
                        aria-disabled={isRunning || isTyping}
                        className="rounded-full hover:border-primary/50 hover:bg-secondary hover:text-primary aria-disabled:opacity-60 dark:hover:bg-secondary"
                    >
                        {isRunning ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        {isRunning ? 'Searching harder…' : 'Search harder'}
                    </Button>
                </>
            )}
        </div>
    );
}
