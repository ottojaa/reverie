import { beforeEach, describe, expect, it, vi } from 'vitest';

const counts = vi.hoisted(() => ({ ocr: {}, llm: {}, embed: {} }) as Record<'ocr' | 'llm' | 'embed', Record<string, number>>);

vi.mock('../queues/ocr.queue', () => ({ getOcrQueue: () => ({ getJobCounts: async () => counts.ocr }) }));
vi.mock('../queues/llm.queue', () => ({ getLlmQueue: () => ({ getJobCounts: async () => counts.llm }) }));
vi.mock('../queues/embed.queue', () => ({ getEmbedQueue: () => ({ getJobCounts: async () => counts.embed }) }));

import { isPipelineBusy } from './backfill';

describe('isPipelineBusy', () => {
    beforeEach(() => {
        counts.ocr = { waiting: 0, prioritized: 0, active: 0 };
        counts.llm = { waiting: 0, prioritized: 0, active: 0 };
        // The backfill job is itself the one active job in the embed queue.
        counts.embed = { waiting: 0, prioritized: 0, active: 1 };
    });

    it('is quiet when only the backfill job itself is running', async () => {
        expect(await isPipelineBusy()).toBe(false);
    });

    it.each(['waiting', 'prioritized', 'active'])('holds the backfill back for an OCR job that is %s', async (state) => {
        counts.ocr = { ...counts.ocr, [state]: 1 };

        expect(await isPipelineBusy()).toBe(true);
    });

    it('holds the backfill back for a prioritised summary job (BullMQ does not count those as waiting)', async () => {
        counts.llm = { waiting: 0, prioritized: 3, active: 0 };

        expect(await isPipelineBusy()).toBe(true);
    });

    it('holds the backfill back while embed jobs besides itself are active', async () => {
        counts.embed = { waiting: 0, prioritized: 0, active: 2 };

        expect(await isPipelineBusy()).toBe(true);
    });
});
