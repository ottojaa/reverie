import type { Document, Entity, LlmMetadata } from '@reverie/shared';

export function formatCategory(category: string): string {
    return category
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Safely parse llm_metadata from the loosely-typed API field into the domain LlmMetadata shape.
 * The actual data uses camelCase (matches backend EnhancedMetadata).
 */
export function parseLlmMetadata(raw: Record<string, unknown> | null | undefined): LlmMetadata | null {
    if (!raw || typeof raw !== 'object') return null;

    // Skip if this is a "skipped" metadata record
    if (raw.skipped === true) return null;

    const parseStringArray = (val: unknown): string[] => (Array.isArray(val) ? val.filter((s): s is string => typeof s === 'string') : []);

    // keyEntities is Entity[]
    const rawEntities = typeof raw.entities === 'object' && raw.entities != null ? (raw.entities as Entity[]) : [];

    const result: LlmMetadata = {
        type: raw.type === 'vision_describe' ? 'vision_describe' : 'text_summary',
        entities: rawEntities.map((entity) => ({
            type: entity.type,
            canonical_name: entity.canonical_name,
            raw_text: entity.raw_text,
            confidence: entity.confidence,
        })),
        topics: parseStringArray(raw.topics),
    };

    if (typeof raw.title === 'string') result.title = raw.title;

    if (typeof raw.language === 'string') result.language = raw.language;

    if (typeof raw.documentType === 'string') result.documentType = raw.documentType;

    if (typeof raw.extractedDate === 'string') result.extractedDate = raw.extractedDate;

    if (Array.isArray(raw.extractedDates)) {
        result.extractedDates = raw.extractedDates
            .filter(
                (d): d is { date: string; context: string } | string =>
                    (typeof d === 'object' && d != null && typeof (d as Record<string, unknown>).date === 'string') || typeof d === 'string',
            )
            .map((d) => (typeof d === 'string' ? { date: d, context: '' } : d));
    }

    if (Array.isArray(raw.keyValues)) {
        result.keyValues = raw.keyValues.filter(
            (kv): kv is { label: string; value: string } =>
                typeof kv === 'object' &&
                kv != null &&
                typeof (kv as Record<string, unknown>).label === 'string' &&
                typeof (kv as Record<string, unknown>).value === 'string',
        );
    }

    if (Array.isArray(raw.tableData)) {
        result.tableData = raw.tableData.filter(
            (row): row is { item: string; columns: Record<string, string> } =>
                typeof row === 'object' && row != null && typeof (row as Record<string, unknown>).item === 'string',
        );
    }

    return result;
}

/**
 * True when the stored llm_metadata is a fallback record (written when the LLM
 * is unavailable — see backend buildFallbackSummary): its "summary" is just a
 * truncated OCR preview, not real insights, and must not be presented as AI.
 */
export function isFallbackLlmMetadata(raw: Record<string, unknown> | null | undefined): boolean {
    return !!raw && typeof raw === 'object' && raw.fallback === true;
}

/**
 * What the toolbar subtitle should communicate about a document's AI pipeline.
 * Derived from document statuses (job events carry no job_type, so the
 * websocket-refetched document is the source of truth).
 */
export type InsightPhase =
    | { kind: 'reading' } // OCR running — "Reading document…"
    | { kind: 'writing' } // LLM running/queued — "Writing summary…"
    | { kind: 'summary'; summary: string } // teaser
    | { kind: 'failed'; stage: 'ocr' | 'llm' }
    | { kind: 'idle' }; // nothing AI to show — fall back to the file-type label

export function toInsightPhase(document: Document): InsightPhase {
    const ocrStatus = document.ocr_status ?? 'skipped';
    const llmStatus = document.llm_status ?? 'skipped';

    if (ocrStatus === 'pending' || ocrStatus === 'processing') return { kind: 'reading' };

    if (llmStatus === 'pending' || llmStatus === 'processing') return { kind: 'writing' };

    if (llmStatus === 'failed') return { kind: 'failed', stage: 'llm' };

    // An existing summary outranks a (re-run) OCR failure — the failure still
    // surfaces in the panel's processing footer.
    if (document.llm_summary && !isFallbackLlmMetadata(document.llm_metadata)) {
        return { kind: 'summary', summary: document.llm_summary };
    }

    if (ocrStatus === 'failed') return { kind: 'failed', stage: 'ocr' };

    return { kind: 'idle' };
}
