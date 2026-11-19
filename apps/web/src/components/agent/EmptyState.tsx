import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

const SUGGESTIONS = [
    'What is in my library? Give me a short overview.',
    'Find documents that look like invoices and tell me where they live.',
    'Suggest a tidier folder structure for my loose documents, preview only.',
];

/** The blank thread: what the agent can do and a few ways in. A suggestion fills the box; it never sends. */
export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
    return (
        <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-5 px-4 py-10 text-center" data-testid="agent-empty">
            <div className="flex size-11 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="size-5 text-primary" aria-hidden />
            </div>
            <div>
                <h2 className="text-lg font-semibold tracking-tight">Ask the agent about your library</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                    It can search and read your documents, then move, rename and tag them. Every change it makes can be undone, and for photos it only sees
                    details, never the pictures.
                </p>
            </div>
            <div className="flex w-full flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                    <Button
                        key={suggestion}
                        type="button"
                        variant="outline"
                        className="h-auto justify-start whitespace-normal px-3 py-2 text-left font-normal"
                        onClick={() => onPick(suggestion)}
                    >
                        {suggestion}
                    </Button>
                ))}
            </div>
        </div>
    );
}
