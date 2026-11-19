import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queue.config';
import { getRedisConnectionOptions } from './redis';

export interface TrashPurgeJobResult {
    documents: number;
    folders: number;
}

/** How often the retention purge runs. The retention period itself is the `trash.retentionDays` setting. */
export const TRASH_PURGE_INTERVAL_MS = 60 * 60 * 1000;

const TRASH_PURGE_SCHEDULER_ID = 'trash-purge-hourly';

let trashQueueInstance: Queue | null = null;

export function getTrashQueue(): Queue {
    if (!trashQueueInstance) {
        trashQueueInstance = new Queue(QUEUE_NAMES.TRASH, {
            connection: getRedisConnectionOptions(),
            // Maintenance job: no retries needed, the next run picks up whatever this one missed.
            defaultJobOptions: { attempts: 1, removeOnComplete: { count: 24 }, removeOnFail: { count: 24 } },
        });
    }

    return trashQueueInstance;
}

/** Register the repeatable purge job. Idempotent: the scheduler id is fixed, so restarts do not stack jobs. */
export async function scheduleTrashPurge(): Promise<void> {
    await getTrashQueue().upsertJobScheduler(TRASH_PURGE_SCHEDULER_ID, { every: TRASH_PURGE_INTERVAL_MS }, { name: 'purge-expired' });
}

export async function closeTrashQueue(): Promise<void> {
    if (trashQueueInstance) {
        await trashQueueInstance.close();
        trashQueueInstance = null;
    }
}
