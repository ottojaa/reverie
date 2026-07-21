import { getRedisSubscriber, JOB_EVENTS_CHANNEL } from '../queues/redis';
import { sendToUser, sendToSession, sendToDocument } from './socket.server';
import type { JobEventPayload } from '../workers/worker.utils';

let isSubscribed = false;

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

        try {
            const event: JobEventPayload = JSON.parse(message);

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
            console.error('[RedisSubscriber] Failed to parse message:', error);
        }
    });

    // Handle errors
    subscriber.on('error', (error) => {
        console.error('[RedisSubscriber] Redis error:', error);
    });
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
