import Redis from 'ioredis'
import { env } from '../config/env'

// Create Redis connection options that work with BullMQ
export function getRedisConnectionOptions() {
  return {
    host: new URL(env.REDIS_URL).hostname,
    port: parseInt(new URL(env.REDIS_URL).port || '6379'),
    maxRetriesPerRequest: null, // Required for BullMQ
  }
}

// Connection for pub/sub (publishing job events)
let publisherInstance: Redis | null = null

export function getRedisPublisher(): Redis {
  if (!publisherInstance) {
    publisherInstance = new Redis(env.REDIS_URL)
  }
  return publisherInstance
}

// Connection for pub/sub (subscribing to job events)
let subscriberInstance: Redis | null = null

export function getRedisSubscriber(): Redis {
  if (!subscriberInstance) {
    subscriberInstance = new Redis(env.REDIS_URL)
  }
  return subscriberInstance
}

// Close all Redis connections
export async function closeRedisConnections(): Promise<void> {
  const promises: Promise<void>[] = []

  if (publisherInstance) {
    promises.push(
      publisherInstance.quit().then(() => {
        publisherInstance = null
      })
    )
  }

  if (subscriberInstance) {
    promises.push(
      subscriberInstance.quit().then(() => {
        subscriberInstance = null
      })
    )
  }

  await Promise.all(promises)
}

// Redis pub/sub channel for job events
export const JOB_EVENTS_CHANNEL = 'job:events'
