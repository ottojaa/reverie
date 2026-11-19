import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useUndoAgentWrite } from '@/lib/agent/useAgentLive';
import { cn } from '@/lib/utils';
import type { AgentToolItem } from '@reverie/shared';
import { AlertCircle, Check, Undo2 } from 'lucide-react';
import { canUndo, toSampleNames, toToolLabel, toToolSummary } from './tool-summary';

/** One tool call, compact: what ran, what it did, and for an applied write, an Undo. */
export function ToolCallRow({ tool }: { tool: AgentToolItem }) {
    const undo = useUndoAgentWrite();
    const samples = tool.applied ? toSampleNames(tool.output).slice(0, 3) : [];
    const isError = tool.status === 'error';

    return (
        <div className={cn('rounded-lg border bg-card px-3 py-2 text-sm', isError ? 'border-destructive/40' : 'border-border')} data-testid="tool-call">
            <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0" aria-hidden>
                    {tool.status === 'running' && <Spinner className="size-3.5 text-muted-foreground" />}
                    {tool.status === 'done' && <Check className="size-3.5 text-success" />}
                    {isError && <AlertCircle className="size-3.5 text-destructive" />}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-muted-foreground">{toToolLabel(tool.name)}</p>
                    <p className={cn('break-words text-foreground', isError && 'text-destructive')}>{toToolSummary(tool)}</p>
                    {samples.length > 0 && <p className="mt-0.5 truncate text-xs text-muted-foreground">{samples.join(', ')}</p>}
                </div>
                {tool.undone && <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">Undone</span>}
                {canUndo(tool) && !tool.undone && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0"
                        disabled={undo.isPending}
                        onClick={() => undo.mutate(tool.audit_id!)}
                    >
                        {undo.isPending ? <Spinner className="size-3" /> : <Undo2 className="size-3" />}
                        Undo
                    </Button>
                )}
            </div>
        </div>
    );
}
