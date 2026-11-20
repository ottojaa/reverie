import { db } from '../db/kysely';
import { getRedisSubscriber, JOB_EVENTS_CHANNEL } from '../queues/redis';
import { isDocumentPrivate } from '../services/privacy';
import { sendToUser, sendToSession, sendToDocument } from './socket.server';
import type { JobEventPayload } from '../workers/worker.utils';

let isSubscribed = false;

/**
 * Job results and error text can quote a document's content, so for a document in a private
 * folder the finishing events carry only the status. A document that cannot be found (already
 * deleted) is treated as private rather than risk leaking its result.
 */
export async function toDeliverableEvent(event: JobEventPayload): Promise<JobEventPayload> {
    if (!event.document_id || (event.type !== 'job:complete' && event.type !== 'job:failed')) return event;

    const document = await db.selectFrom('documents').select(['user_id', 'folder_id']).where('id', '=', event.document_id).executeTakeFirst();

    if (document && !(await isDocumentPrivate(document))) return event;

    const { result: _result, error_message: _errorMessage, ...statusOnly } = event;

    return statusOnly;
}

/**
 * Start subscribing to Redis job events and forward to WebSocket clients
 */
export async function startRedisSubscriber(): Promise<void> {
    if (isSubscribed) {
        console.log('[RedisSubscriber] Already subscribed');

        return;
    }

    const subscriber = getRedisSubscriber();

    // Subscribe to job events channel
    await subscriber.subscribe(JOB_EVENTS_CHANNEL);
    isSubscribed = true;

    console.log(`[RedisSubscriber] Subscribed to channel: ${JOB_EVENTS_CHANNEL}`);

    // Handle incoming messages
    subscriber.on('message', (channel: string, message: string) => {
        if (channel !== JOB_EVENTS_CHANNEL) return;

        void deliverJobEvent(message);
    });

    // Handle errors
    subscriber.on('error', (error) => {
        console.error('[RedisSubscriber] Redis error:', error);
    });
}

/** Parse a job event from Redis, redact it where needed, and forward it to the owner's rooms. */
async function deliverJobEvent(message: string): Promise<void> {
    try {
        const event = await toDeliverableEvent(JSON.parse(message) as JobEventPayload);

        console.log(`[RedisSubscriber] Received event: ${event.type}`, {
            jobId: event.job_id,
            documentId: event.document_id,
            status: event.status,
        });

        // Route only to rooms the owner can be in — never a global broadcast.
        let sent = false;

        // Document room is owner-only (joins are authorized), so it's safe without user_id.
        if (event.document_id) {
            sendToDocument(event.document_id, event.type, event);
            sent = true;
        }

        // Session room is namespaced under the owner, so routing needs the user id.
        if (event.session_id && event.user_id) {
            sendToSession(event.user_id, event.session_id, event.type, event);
            sent = true;
        }

        // Fall back to the owner's user room (replaces the old global broadcast).
        if (!sent && event.user_id) {
            sendToUser(event.user_id, event.type, event);
            sent = true;
        }

        if (!sent) {
            console.warn(`[RedisSubscriber] Dropping event with no routable target: ${event.type} ${event.job_id}`);
        }
    } catch (error) {
        console.error('[RedisSubscriber] Failed to deliver job event:', error);
    }
}

/**
 * Stop the Redis subscriber
 */
export async function stopRedisSubscriber(): Promise<void> {
    if (!isSubscribed) return;

    const subscriber = getRedisSubscriber();
    await subscriber.unsubscribe(JOB_EVENTS_CHANNEL);
    isSubscribed = false;

    console.log('[RedisSubscriber] Unsubscribed from all channels');
}
