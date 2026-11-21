import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
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
    const anthropic = { parse: vi.fn() };
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
    getStorageService: () => ({ getFile: async () => Buffer.from(TINY_PNG_BASE64, 'base64') }),
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
// A real 1x1 PNG: the image call decodes and re-encodes the file with sharp before it sends it.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
        // A classified, non-photo image: the vision gate holds back photos and unclassified images.
        document_category: isVisionImage ? 'screenshot' : null,
        original_filename: 'doc-1',
    } as unknown as Document;

    h.tables.documents = [document as unknown as Row];
    h.tables.photo_metadata = [];
    // An image the classifier judged a screenshot. The image call needs a verdict: a category alone is not enough.
    h.tables.document_image_kinds = isVisionImage ? [{ document_id: 'doc-1', kind: 'screenshot' }] : [];
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
            // Only the image call reads these two; the text summary ignores them.
            kind: 'screenshot',
            app_or_source: 'Acme app',
        },
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
    });
}

function expectNoAnthropicCall() {
    expect(h.anthropic.parse).not.toHaveBeenCalled();
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
    { forceType: 'image_understanding', mimeType: 'image/jpeg', label: 'forced image_understanding' },
    // Jobs queued before the image call existed carry the old type.
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

    it('sends a public screenshot to the image call: the image, then the text', async () => {
        seed('public', 'image/jpeg');

        await processDocument('doc-1', { forceType: 'image_understanding' });

        expect(h.anthropic.parse).toHaveBeenCalledTimes(1);

        const content = h.anthropic.parse.mock.calls[0]?.[0].messages[0].content;

        expect(content.map((block: { type: string }) => block.type)).toEqual(['image', 'text']);
        expect(content[0].source.media_type).toBe('image/jpeg');
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

describe('photos never reach the image call', () => {
    const CAMERA_EXIF = { document_id: 'doc-1', taken_at: new Date('2024-06-01T10:00:00Z'), latitude: null, longitude: null };
    const GPS_ONLY_EXIF = { document_id: 'doc-1', taken_at: null, latitude: 60.17, longitude: 24.94 };
    const HELD_BACK = [
        { label: "the 'photo' category", category: 'photo', exif: [] },
        { label: 'camera EXIF with a capture date', category: 'screenshot', exif: [CAMERA_EXIF] },
        { label: 'camera EXIF with a GPS position', category: 'screenshot', exif: [GPS_ONLY_EXIF] },
        { label: 'no category yet', category: null, exif: [] },
    ] as const;

    function seedImage({ category, exif }: { category: string | null; exif: readonly Row[] }) {
        seed('public', 'image/jpeg');
        h.tables.documents = [{ ...h.tables.documents![0], document_category: category }];
        h.tables.photo_metadata = [...exif];
    }

    function runVisionJob(type: LlmJobData['type']) {
        createLlmWorker();

        const job = { id: 'job-1', data: { documentId: 'doc-1', userId: USER, type }, opts: { attempts: 2 } } as unknown as Job<LlmJobData>;

        return h.worker.processor!(job);
    }

    for (const held of HELD_BACK) {
        for (const forceType of [undefined, 'image_understanding', 'vision_describe'] as const) {
            const how = forceType ? `a forced ${forceType}` : 'the type eligibility picks';

            it(`processDocument refuses ${held.label} with ${how}`, async () => {
                seedImage(held);

                const result = await processDocument('doc-1', { forceType });

                expect(result).toMatchObject({ success: true, skipped: true, reason: 'photo' });
                expectNoAnthropicCall();
                expect(h.updates).toContainEqual({ table: 'documents', values: { llm_status: 'skipped' } });
            });

            it(`a queued job for ${held.label} (${how}) ends skipped with the photo reason, not failed`, async () => {
                seedImage(held);

                const result = await runVisionJob(forceType);

                expect(result).toMatchObject({ skipped: true, skipReason: 'photo' });
                expectNoAnthropicCall();
                expect(h.jobService.markJobSkipped).toHaveBeenCalledTimes(1);
                expect(h.jobService.markJobFailed).not.toHaveBeenCalled();
                expect(h.updates).not.toContainEqual({ table: 'documents', values: { llm_status: 'failed' } });
            });
        }
    }

    it('sends a screenshot with no OCR text to the image call when a job is queued directly', async () => {
        seedImage({ category: 'screenshot', exif: [] });

        const result = await runVisionJob('image_understanding');

        expect(result.skipped).toBeUndefined();
        expect(h.anthropic.parse).toHaveBeenCalledTimes(1);
        expect(h.anthropic.parse.mock.calls[0]?.[0].messages[0].content[1].text).toContain('none was found');
    });

    it.each(['screenshot', 'graphic', 'invoice', 'receipt'])(
        'an image in the %s category with no verdict gets no call, even with a forced type',
        async (category) => {
            seedImage({ category, exif: [] });
            h.tables.document_image_kinds = [];

            const result = await processDocument('doc-1', { forceType: 'image_understanding' });

            expect(result).toMatchObject({ skipped: true, reason: 'photo' });
            expectNoAnthropicCall();
        },
    );

    it.each(['image_understanding', 'vision_describe'] as const)('a queued %s job sends no image once vision is switched off', async (forceType) => {
        seedImage({ category: 'screenshot', exif: [] });
        env.LLM_VISION_ENABLED = false;

        try {
            await processDocument('doc-1', { forceType });
        } finally {
            env.LLM_VISION_ENABLED = true;
        }

        expectNoAnthropicCall();
    });

    it('sends a diagram when eligibility picks the type', async () => {
        seedImage({ category: 'graphic', exif: [] });
        h.tables.document_image_kinds = [{ document_id: 'doc-1', kind: 'diagram' }];

        await processDocument('doc-1');

        expect(h.anthropic.parse).toHaveBeenCalledTimes(1);
    });

    describe('with a kind verdict', () => {
        const MAKE = { document_id: 'doc-1', taken_at: null, latitude: null, longitude: null, camera_make: 'Canon', camera_model: null, lens_model: null };

        function seedVerdict(kind: string, exif: readonly Row[] = []) {
            seedImage({ category: 'screenshot', exif });
            h.tables.document_image_kinds = [{ document_id: 'doc-1', kind }];
        }

        it.each(['photo', 'other'])('a %s verdict gets no call, even in a screenshot category', async (kind) => {
            seedVerdict(kind);

            const result = await processDocument('doc-1', { forceType: 'image_understanding' });

            expect(result.skipped).toBe(true);
            expectNoAnthropicCall();
        });

        it.each(['document', 'receipt', 'screenshot', 'diagram'])('a %s verdict gets the call', async (kind) => {
            seedVerdict(kind);

            await processDocument('doc-1');

            expect(h.anthropic.parse).toHaveBeenCalledTimes(1);
        });

        it('camera evidence gets no call, even with a document verdict', async () => {
            seedVerdict('document', [MAKE]);

            const result = await processDocument('doc-1', { forceType: 'image_understanding' });

            expect(result).toMatchObject({ skipped: true, reason: 'photo' });
            expectNoAnthropicCall();
        });

        it('a directly queued job for a camera-backed document image ends skipped, not failed', async () => {
            seedVerdict('document', [MAKE]);

            const result = await runVisionJob('image_understanding');

            expect(result).toMatchObject({ skipped: true, skipReason: 'photo' });
            expectNoAnthropicCall();
            expect(h.jobService.markJobFailed).not.toHaveBeenCalled();
        });

        it('a private screenshot gets no call even with a screenshot verdict', async () => {
            seed('folder', 'image/jpeg');
            h.tables.document_image_kinds = [{ document_id: 'doc-1', kind: 'screenshot' }];

            const result = await processDocument('doc-1', { forceType: 'image_understanding' });

            expect(result).toMatchObject({ skipped: true, reason: 'private' });
            expectNoAnthropicCall();
        });
    });

    it('a PDF still gets the text summary, with no image in the request', async () => {
        seed('public', 'application/pdf');

        const result = await processDocument('doc-1');

        expect(result.skipped).toBeUndefined();
        expect(h.anthropic.parse).toHaveBeenCalledTimes(1);
        expect(typeof h.anthropic.parse.mock.calls[0]?.[0].messages[0].content).toBe('string');
    });

    it('a photo with readable text still gets the text summary, never its pixels', async () => {
        seedImage({ category: 'photo', exif: [] });
        h.tables.documents = [{ ...h.tables.documents![0], has_meaningful_text: true }];
        h.tables.ocr_results = [{ document_id: 'doc-1', raw_text: 'Opening hours 9-17 weekdays', confidence_score: 90 }];

        await processDocument('doc-1');

        const content = h.anthropic.parse.mock.calls[0]?.[0].messages[0].content;

        expect(typeof content).toBe('string');
    });
});
