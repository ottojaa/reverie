import { expect, it, vi } from 'vitest';

vi.mock('../db/kysely', async () => ({ db: (await import('../testing/db-proxy.js')).dbProxy.db }));
vi.mock('../queues/redis', () => ({ getRedisSubscriber: vi.fn(), JOB_EVENTS_CHANNEL: 'job-events' }));
vi.mock('./socket.server', () => ({ sendToUser: vi.fn(), sendToSession: vi.fn(), sendToDocument: vi.fn() }));

import { describeDb, useWorld } from '../testing/tool-world.js';
import type { JobEventPayload } from '../workers/worker.utils.js';
import { toDeliverableEvent } from './redis-subscriber.js';

const finished = (documentId: string, type: JobEventPayload['type'] = 'job:complete'): JobEventPayload => ({
    type,
    job_id: 'job-1',
    document_id: documentId,
    status: type === 'job:failed' ? 'failed' : 'complete',
    result: { text: 'SECRET OCR TEXT' },
    error_message: 'could not read SECRET OCR TEXT',
    timestamp: '2026-01-01T00:00:00.000Z',
});

describeDb('realtime job events', () => {
    const ctx = useWorld();

    it('leaves the result of a document in a public folder alone', async () => {
        const event = finished(ctx.world().docs.invoice);

        expect(await toDeliverableEvent(event)).toEqual(event);
    });

    it('strips the result and error text of documents in private folders, at any depth', async () => {
        const { docs } = ctx.world();

        for (const id of [docs.inLockedFolder, docs.inVault, docs.inVaultInner]) {
            for (const type of ['job:complete', 'job:failed'] as const) {
                const delivered = await toDeliverableEvent(finished(id, type));

                expect(JSON.stringify(delivered)).not.toContain('SECRET');
                expect(delivered).toMatchObject({ type, job_id: 'job-1', document_id: id });
            }
        }
    });

    it('strips the result of a document that no longer exists', async () => {
        const delivered = await toDeliverableEvent(finished('00000000-0000-4000-8000-000000000000'));

        expect(JSON.stringify(delivered)).not.toContain('SECRET');
    });

    it('passes progress events through untouched', async () => {
        const event: JobEventPayload = {
            type: 'job:progress',
            job_id: 'j',
            document_id: ctx.world().docs.inVault,
            status: 'processing',
            progress: 50,
            timestamp: 't',
        };

        expect(await toDeliverableEvent(event)).toEqual(event);
    });
});
