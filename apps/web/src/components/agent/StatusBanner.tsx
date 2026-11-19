import { Button } from '@/components/ui/button';
import type { AgentStatus } from '@reverie/shared';
import { KeyRound, PlugZap } from 'lucide-react';

const SIGN_IN_COMMAND = 'docker compose -f docker-compose.prod.yml exec -it reverie-agent claude';

interface StatusBannerProps {
    state: Exclude<AgentStatus['state'], 'ready'>;
    onRecheck: () => void;
    checking: boolean;
}

/** Shown instead of the composer's promise when the agent cannot answer: the one-time sign-in, or no container. */
export function StatusBanner({ state, onRecheck, checking }: StatusBannerProps) {
    const isSignedOut = state === 'not_signed_in';
    const Icon = isSignedOut ? KeyRound : PlugZap;

    return (
        <div className="mx-auto w-full max-w-3xl px-3 pt-3 sm:px-4" data-testid="agent-status-banner">
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
                <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">{isSignedOut ? 'The agent is not signed in' : 'The agent is not reachable'}</p>
                        {isSignedOut ? (
                            <>
                                <p className="mt-1 text-muted-foreground">
                                    Run the one-time sign-in on the server, finish it in your browser, then check again:
                                </p>
                                <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-secondary px-3 py-2 font-mono text-xs">
                                    {SIGN_IN_COMMAND}
                                </code>
                            </>
                        ) : (
                            <p className="mt-1 text-muted-foreground">
                                The reverie-agent container did not answer. Check that it is running (docker compose ps), then check again.
                            </p>
                        )}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={onRecheck} disabled={checking}>
                        Check again
                    </Button>
                </div>
            </div>
        </div>
    );
}
