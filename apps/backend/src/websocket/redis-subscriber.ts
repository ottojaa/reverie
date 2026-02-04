import { getRedisSubscriber, JOB_EVENTS_CHANNEL } from '../queues/redis'
import { broadcastEvent, sendToSession, sendToDocument } from './socket.server'
import type { JobEventPayload } from '../workers/worker.utils'

let isSubscribed = false

/**
 * Start subscribing to Redis job events and forward to WebSocket clients
 */
export async function startRedisSubscriber(): Promise<void> {
  if (isSubscribed) {
    console.log('[RedisSubscriber] Already subscribed')
    return
  }

  const subscriber = getRedisSubscriber()

  // Subscribe to job events channel
  await subscriber.subscribe(JOB_EVENTS_CHANNEL)
  isSubscribed = true

  console.log(`[RedisSubscriber] Subscribed to channel: ${JOB_EVENTS_CHANNEL}`)

  // Handle incoming messages
  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== JOB_EVENTS_CHANNEL) return

    try {
      const event: JobEventPayload = JSON.parse(message)

      console.log(`[RedisSubscriber] Received event: ${event.type}`, {
        jobId: event.job_id,
        documentId: event.document_id,
        status: event.status,
      })

      // Send to specific rooms based on event metadata
      let sent = false

      // Send to specific session room if session_id is present
      if (event.session_id) {
        sendToSession(event.session_id, event.type, event)
        sent = true
      }

      // Send to specific document room if document_id is present
      if (event.document_id) {
        sendToDocument(event.document_id, event.type, event)
        sent = true
      }

      // Broadcast to all clients only if no specific target (for global dashboards)
      if (!sent) {
        broadcastEvent(event.type, event)
      }
    } catch (error) {
      console.error('[RedisSubscriber] Failed to parse message:', error)
    }
  })

  // Handle errors
  subscriber.on('error', (error) => {
    console.error('[RedisSubscriber] Redis error:', error)
  })
}

/**
 * Stop the Redis subscriber
 */
export async function stopRedisSubscriber(): Promise<void> {
  if (!isSubscribed) return

  const subscriber = getRedisSubscriber()
  await subscriber.unsubscribe(JOB_EVENTS_CHANNEL)
  isSubscribed = false

  console.log('[RedisSubscriber] Unsubscribed from all channels')
}


