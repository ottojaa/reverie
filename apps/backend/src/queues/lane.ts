import type { ProcessingLane } from '@reverie/shared';
import type { JobsOptions } from 'bullmq';
import { db } from '../db/kysely';

/**
 * BullMQ serves unprioritised jobs first, then lower numbers. A normal document's jobs use at most 10 (backfills
 * included), so this puts a background document's jobs behind all of them.
 */
const BACKGROUND_PRIORITY = 100;

async function fetchLane(documentId: string): Promise<ProcessingLane> {
    const document = await db.selectFrom('documents').select('processing_lane').where('id', '=', documentId).executeTakeFirst();

    return document?.processing_lane ?? 'normal';
}

/** The lane of a document's next job, and the BullMQ options to add it with: `options` untouched for a normal document. */
export async function fetchLaneJob(documentId: string, options: JobsOptions): Promise<{ lane: ProcessingLane; options: JobsOptions }> {
    const lane = await fetchLane(documentId);

    if (lane === 'normal') return { lane, options };

    return { lane, options: { ...options, priority: BACKGROUND_PRIORITY } };
}

/** For the owner's own action on a document: the jobs queued from now on run as a normal document's. */
export async function promoteToNormal(documentId: string): Promise<void> {
    await db.updateTable('documents').set({ processing_lane: 'normal' }).where('id', '=', documentId).where('processing_lane', '=', 'background').execute();
}
