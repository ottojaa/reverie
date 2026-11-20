import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Document } from '../db/schema';
import type { LlmJobData } from '../queues/llm.queue';
import { createLlmWorker } from '../workers/llm.worker';
import { checkLlmEligibility } from './eligibility';
import { processDocument } from './llm.service';

type Row = Record<string, unknown>;
type JobProcessor = (job: Job<LlmJobData>) => Promise<{ skipped?: boolean; skipReason?: string }>;

const h = vi.hoisted(() => {
    const tables: Record<string, Row[]> = {};
    const updates: Array<{ table: string; values: Row }> = [];
    const anthropic = { parse: vi.fn(), create: vi.fn() };
    const jobService = {
        markJobStarted: vi.fn(),
        markJobComplete: vi.fn(),
        markJobSkipped: vi.fn(),
        markJobFailed: vi.fn(),
        incrementAttempts: vi.fn(),
    };
    const worker: { processor: JobProcessor | null } = { processor: null };

    // A tiny in-memory stand-in for Kysely: selects filter the seeded tables on `=` and
    // `in`, so the real privacy cascade (folders -> collection) runs against it. Updates are
    // recorded; every other write is a no-op.
    function selectBuilder(table: string) {
        const filters: Array<(row: Row) => boolean> = [];
        const rows = () => (tables[table] ?? []).filter((row) => filters.every((matches) => matches(row)));
        const builder = {
            select: () => builder,
            selectAll: () => builder,
            where: (column: string, op: string, value: unknown) => {
                filters.push((row) => (op === 'in' ? (value as unknown[]).includes(row[column]) : row[column] === value));

                return builder;
            },
            execute: async () => rows(),
            executeTakeFirst: async () => rows()[0],
        };

        return builder;
    }

    function updateBuilder(table: string) {
        const builder = {
            set: (values: Row) => {
                updates.push({ table, values });

                return builder;
            },
            where: () => builder,
            execute: async () => [],
        };

        return builder;
    }

    const noopWrite: object = new Proxy(() => noopWrite, {
        get: (_target, prop) => (prop === 'execute' || prop === 'executeTakeFirst' ? async () => undefined : () => noopWrite),
        apply: () => noopWrite,
    });

    const db = {
        selectFrom: selectBuilder,
        updateTable: updateBuilder,
        insertInto: () => noopWrite,
        deleteFrom: () => noopWrite,
        transaction: () => ({ execute: async (run: (trx: unknown) => Promise<unknown>) => run(db) }),
    };

    return { tables, updates, anthropic, jobService, worker, db };
});

vi.mock('../db/kysely', () => ({ db: h.db }));
vi.mock('../config/env', () => ({
    env: {
        NODE_ENV: 'test',
        ANTHROPIC_API_KEY: 'test-key',
        ANTHROPIC_SUMMARY_MODEL: 'summary-model',
        ANTHROPIC_VISION_MODEL: 'vision-model',
        LLM_ENABLED: true,
        LLM_VISION_ENABLED: true,
        LLM_PROCESS_CODE_FILES: false,
        LLM_MIN_OCR_CONFIDENCE: 50,
        LLM_MAX_INPUT_CHARS: 20000,
        LLM_MAX_OUTPUT_TOKENS: 2000,
        LLM_SNIPPET_SIZE: 500,
        JOB_CONCURRENCY_LLM: 1,
        JOB_CONCURRENCY_OCR: 1,
        JOB_CONCURRENCY_THUMBNAIL: 1,
        JOB_CONCURRENCY_TRIM: 1,
        JOB_RETRY_ATTEMPTS: 2,
        JOB_RETRY_BACKOFF_MS: 1,
        REDIS_URL: 'redis://localhost:6379',
    },
}));
vi.mock('@anthropic-ai/sdk', () => ({
    default: class {
        messages = h.anthropic;
    },
}));
vi.mock('../search/search-indexer', () => ({ rebuildSearchVector: vi.fn() }));
vi.mock('../services/storage.service', () => ({
    assertFitsInMemory: vi.fn(),
    getStorageService: () => ({ getFile: async () => Buffer.from('image-bytes') }),
}));
vi.mock('../queues/redis', () => ({
    getRedisConnectionOptions: () => ({}),
    getRedisPublisher: () => ({ publish: vi.fn() }),
    JOB_EVENTS_CHANNEL: 'job-events',
}));
vi.mock('../jobs/job.service', () => ({ getJobService: () => h.jobService }));
vi.mock('bullmq', () => ({
    Worker: class {
        constructor(_queue: string, processor: JobProcessor) {
            h.worker.processor = processor;
        }

        on() {
            return this;
        }
    },
}));

const USER = 'user-1';

function seed(kind: 'folder' | 'collection' | 'public', mimeType: string) {
    const isVisionImage = mimeType.startsWith('image/');
    const folderId = kind === 'folder' || kind === 'collection' ? 'folder-1' : null;

    h.tables.folders = [
        { id: 'collection-1', user_id: USER, parent_id: null, is_private: kind === 'collection' },
        { id: 'folder-1', user_id: USER, parent_id: 'collection-1', is_private: kind === 'folder' },
        { id: 'other-folder', user_id: USER, parent_id: 'collection-1', is_private: false },
    ];

    const document = {
        id: 'doc-1',
        user_id: USER,
        folder_id: folderId,
        mime_type: mimeType,
        file_path: 'files/doc-1',
        size_bytes: 100,
        has_meaningful_text: !isVisionImage,
        document_category: null,
        original_filename: 'doc-1',
    } as unknown as Document;

    h.tables.documents = [document as unknown as Row];
    h.tables.ocr_results = isVisionImage
        ? []
        : [{ document_id: 'doc-1', raw_text: 'Invoice from Acme Oy for consulting services', confidence_score: 95, has_meaningful_text: true }];

    return document;
}

function mockAnthropicSuccess() {
    h.anthropic.parse.mockResolvedValue({
        parsed_output: {
            summary: 'An invoice.',
            title: 'Invoice',
            document_type: 'invoice',
            language: 'en',
            entities: [],
            topics: ['billing'],
            tags: ['invoice'],
            extracted_date: null,
        },
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
    });
    h.anthropic.create.mockResolvedValue({
        content: [{ type: 'text', text: '{"description":"A cat","detected_objects":["cat"],"scene_type":"indoor","has_people":false}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
    });
}

function expectNoAnthropicCall() {
    expect(h.anthropic.parse).not.toHaveBeenCalled();
    expect(h.anthropic.create).not.toHaveBeenCalled();
}

beforeEach(() => {
    vi.clearAllMocks();
    h.updates.length = 0;
    mockAnthropicSuccess();
});

const PRIVATE_KINDS = ['folder', 'collection'] as const;
const FORCED_TYPES = [
    { forceType: undefined, mimeType: 'application/pdf', label: 'no forced type' },
    { forceType: 'text_summary', mimeType: 'application/pdf', label: 'forced text_summary' },
    { forceType: 'vision_describe', mimeType: 'image/jpeg', label: 'forced vision_describe' },
] as const;

describe('processDocument privacy gate', () => {
    for (const kind of PRIVATE_KINDS) {
        for (const { forceType, mimeType, label } of FORCED_TYPES) {
            it(`never calls Anthropic for a document private through its ${kind} (${label})`, async () => {
                seed(kind, mimeType);

                const result = await processDocument('doc-1', { forceType });

                expect(result).toMatchObject({ success: true, skipped: true, reason: 'private' });
                expectNoAnthropicCall();
                expect(h.updates).toContainEqual({ table: 'documents', values: { llm_status: 'skipped' } });
            });
        }
    }

    it('calls the text model for a public document', async () => {
        seed('public', 'application/pdf');

        const result = await processDocument('doc-1');

        expect(result.skipped).toBeUndefined();
        expect(h.anthropic.parse).toHaveBeenCalledTimes(1);
    });

    it('calls the text model for a public document inside a public folder of a public collection', async () => {
        seed('public', 'application/pdf');
        h.tables.documents = [{ ...h.tables.documents![0], folder_id: 'other-folder' }];

        await processDocument('doc-1', { forceType: 'text_summary' });

        expect(h.anthropic.parse).toHaveBeenCalledTimes(1);
    });

    it('calls the vision model for a public image', async () => {
        seed('public', 'image/jpeg');

        await processDocument('doc-1', { forceType: 'vision_describe' });

        expect(h.anthropic.create).toHaveBeenCalledTimes(1);
    });
});

describe('LLM worker privacy gate', () => {
    function runJob(type: LlmJobData['type']) {
        createLlmWorker();

        const job = { id: 'job-1', data: { documentId: 'doc-1', userId: USER, type }, opts: { attempts: 2 } } as unknown as Job<LlmJobData>;

        return h.worker.processor!(job);
    }

    for (const kind of PRIVATE_KINDS) {
        for (const { forceType, mimeType, label } of FORCED_TYPES) {
            it(`skips a document private through its ${kind} without a failure or retry (${label})`, async () => {
                seed(kind, mimeType);

                const result = await runJob(forceType);

                expect(result).toMatchObject({ skipped: true, skipReason: 'private' });
                expectNoAnthropicCall();
                expect(h.updates).toContainEqual({ table: 'documents', values: { llm_status: 'skipped' } });
                expect(h.updates).not.toContainEqual({ table: 'documents', values: { llm_status: 'failed' } });
                expect(h.jobService.markJobSkipped).toHaveBeenCalledTimes(1);
                expect(h.jobService.markJobComplete).not.toHaveBeenCalled();
                expect(h.jobService.markJobFailed).not.toHaveBeenCalled();
                expect(h.jobService.incrementAttempts).not.toHaveBeenCalled();
            });
        }
    }

    it('still processes a public document with a forced type', async () => {
        seed('public', 'application/pdf');

        const result = await runJob('text_summary');

        expect(result.skipped).toBeUndefined();
        expect(h.anthropic.parse).toHaveBeenCalledTimes(1);
        expect(h.jobService.markJobComplete).toHaveBeenCalledTimes(1);
        expect(h.jobService.markJobSkipped).not.toHaveBeenCalled();
    });
});

describe('checkLlmEligibility', () => {
    const document = { mime_type: 'application/pdf', has_meaningful_text: true } as Document;

    it('reports private before any other reason', () => {
        expect(checkLlmEligibility(document, null, { isPrivate: true })).toMatchObject({ eligible: false, reason: 'private', processingType: 'skip' });
    });

    it('does not report private for a public document', () => {
        expect(checkLlmEligibility(document, null, { isPrivate: false }).reason).not.toBe('private');
    });
});

describe('trashed documents never reach Anthropic', () => {
    function seedTrashed(mimeType: string) {
        seed('public', mimeType);
        h.tables.documents = [{ ...h.tables.documents![0], deleted_at: new Date() }];
    }

    for (const { forceType, mimeType, label } of FORCED_TYPES) {
        it(`processDocument skips a trashed document (${label})`, async () => {
            seedTrashed(mimeType);

            const result = await processDocument('doc-1', { forceType });

            expect(result).toMatchObject({ success: true, skipped: true, reason: 'trashed' });
            expectNoAnthropicCall();
            expect(h.updates).toContainEqual({ table: 'documents', values: { llm_status: 'skipped' } });
        });

        it(`the worker ends a trashed document's job skipped, not failed (${label})`, async () => {
            seedTrashed(mimeType);
            createLlmWorker();

            const job = { id: 'job-1', data: { documentId: 'doc-1', userId: USER, type: forceType }, opts: { attempts: 2 } } as unknown as Job<LlmJobData>;
            const result = await h.worker.processor!(job);

            expect(result).toMatchObject({ skipped: true, skipReason: 'trashed' });
            expectNoAnthropicCall();
            expect(h.jobService.markJobSkipped).toHaveBeenCalledTimes(1);
            expect(h.jobService.markJobFailed).not.toHaveBeenCalled();
        });
    }

    it('checkLlmEligibility reports trashed', () => {
        const document = { mime_type: 'application/pdf', has_meaningful_text: true, deleted_at: new Date() } as Document;

        expect(checkLlmEligibility(document, null, { isPrivate: false })).toMatchObject({ eligible: false, reason: 'trashed', processingType: 'skip' });
    });
});
