import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useReprocessLlm, useRetryOcr } from '@/lib/api/documents';
import type { Document } from '@reverie/shared';
import { Check, CircleAlert, Loader2, Minus, MoreHorizontal, ScanText } from 'lucide-react';
import { isFallbackLlmMetadata, parseLlmMetadata } from './insight-state';

/** What the stored llm_metadata actually holds, regardless of what llm_status claims. */
type LlmMetadataState = 'insights' | 'fallback' | 'empty';

function toLlmMetadataState(raw: Document['llm_metadata']): LlmMetadataState {
    if (isFallbackLlmMetadata(raw)) return 'fallback';

    return parseLlmMetadata(raw) ? 'insights' : 'empty';
}

interface ProcessingFooterProps {
    document: Document;
    onViewExtractedText: () => void;
}

type StageTone = 'success' | 'running' | 'failed' | 'muted';

interface Stage {
    tone: StageTone;
    label: string;
}

function toOcrStage(status: string): Stage {
    if (status === 'complete') return { tone: 'success', label: 'Text extracted' };

    if (status === 'pending' || status === 'processing') return { tone: 'running', label: 'Extracting text…' };

    if (status === 'failed') return { tone: 'failed', label: 'Text extraction failed' };

    return { tone: 'muted', label: 'No text extracted' };
}

function toLlmStage(status: string, isOcrRunning: boolean, metadataState: LlmMetadataState): Stage {
    // Legacy fallback records mean the LLM never actually ran (no API key) — don't claim success
    if (status === 'complete' && metadataState === 'fallback') return { tone: 'muted', label: 'Insights unavailable' };

    // Eligibility skips are stored as complete with skip metadata — also not a success
    if (status === 'complete' && metadataState === 'empty') return { tone: 'muted', label: 'No insights' };

    if (status === 'complete') return { tone: 'success', label: 'Insights generated' };

    if (status === 'pending' || status === 'processing') return { tone: 'running', label: 'Generating insights…' };

    if (status === 'failed') return { tone: 'failed', label: 'Insights failed' };

    // "skipped" while OCR runs just means the LLM is queued behind it
    if (isOcrRunning) return { tone: 'muted', label: 'Waiting for text…' };

    return { tone: 'muted', label: 'No insights' };
}

function StageStatus({ tone, label }: Stage) {
    return (
        <span className="flex items-center gap-1.5 text-xs">
            {tone === 'success' && <Check className="size-3.5 text-success" />}
            {tone === 'running' && <Loader2 className="size-3.5 animate-spin text-info" />}
            {tone === 'failed' && <CircleAlert className="size-3.5 text-destructive" />}
            {tone === 'muted' && <Minus className="size-3.5 text-muted-foreground/50" />}
            <span className={tone === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{label}</span>
        </span>
    );
}

function RetryButton({ onClick, isPending }: { onClick: () => void; isPending: boolean }) {
    return (
        <Button variant="ghost" size="sm" onClick={onClick} disabled={isPending} className="-ml-1.5 h-6 px-1.5 text-xs text-destructive hover:text-destructive">
            {isPending ? <Loader2 className="size-3 animate-spin" /> : 'Retry'}
        </Button>
    );
}

/** Plain-language processing status with explicit actions — no mystery chips. */
export function ProcessingFooter({ document, onViewExtractedText }: ProcessingFooterProps) {
    const retryOcr = useRetryOcr();
    const reprocessLlm = useReprocessLlm();

    const ocrStatus = document.ocr_status ?? 'skipped';
    const llmStatus = document.llm_status ?? 'skipped';
    const isOcrRunning = ocrStatus === 'pending' || ocrStatus === 'processing';
    const canRunOcr = (ocrStatus === 'failed' || ocrStatus === 'complete' || ocrStatus === 'skipped') && !retryOcr.isPending;
    const canReprocessLlm = (llmStatus === 'failed' || llmStatus === 'complete' || llmStatus === 'skipped') && !isOcrRunning && !reprocessLlm.isPending;

    // On OCR failure there is no extracted text to view and re-running is
    // already offered inline, so the right-hand actions would just add noise.
    const showActions = ocrStatus !== 'failed';

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StageStatus {...toOcrStage(ocrStatus)} />
            {ocrStatus === 'failed' && <RetryButton onClick={() => retryOcr.mutate(document.id)} isPending={retryOcr.isPending} />}

            <StageStatus {...toLlmStage(llmStatus, isOcrRunning, toLlmMetadataState(document.llm_metadata))} />
            {llmStatus === 'failed' && <RetryButton onClick={() => reprocessLlm.mutate(document.id)} isPending={reprocessLlm.isPending} />}

            {showActions && (
                <div className="ml-auto flex items-center gap-0.5">
                    <Button variant="ghost" size="sm" onClick={onViewExtractedText} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground">
                        <ScanText className="size-3.5" />
                        Extracted text
                    </Button>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" title="Processing actions" className="size-7 text-muted-foreground">
                                <MoreHorizontal className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={!canRunOcr} onClick={() => retryOcr.mutate(document.id)}>
                                {ocrStatus === 'skipped' ? 'Run text extraction' : 'Re-run text extraction'}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!canReprocessLlm} onClick={() => reprocessLlm.mutate(document.id)}>
                                {llmStatus === 'skipped' ? 'Generate insights' : 'Regenerate insights'}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}
        </div>
    );
}
