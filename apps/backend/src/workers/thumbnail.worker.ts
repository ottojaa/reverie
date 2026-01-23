import { Worker, Job } from 'bullmq'
import sharp from 'sharp'
import { encode } from 'blurhash'
import { getRedisConnectionOptions } from '../queues/redis'
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../queues/queue.config'
import type { ThumbnailJobData, ThumbnailJobResult } from '../queues/thumbnail.queue'
import { processJobWithTracking, createWorkerLogger, publishJobProgress } from './worker.utils'
import { db } from '../db/kysely'
import { getStorageService } from '../services/storage.service'
import { NonRetryableJobError } from '../jobs/job.types'

const logger = createWorkerLogger('Thumbnail')

// Thumbnail sizes
const THUMBNAIL_SIZES = {
  sm: 150,
  md: 300,
  lg: 600,
} as const

/**
 * Process a thumbnail generation job
 */
async function processThumbnailJob(job: Job<ThumbnailJobData>): Promise<ThumbnailJobResult> {
  const { documentId, filePath } = job.data
  const storageService = getStorageService()

  logger.info('Processing thumbnail job', { documentId, filePath })

  // Verify document exists
  const document = await db
    .selectFrom('documents')
    .selectAll()
    .where('id', '=', documentId)
    .executeTakeFirst()

  if (!document) {
    throw new NonRetryableJobError(`Document ${documentId} not found`)
  }

  await publishJobProgress(job.id!, 10, documentId, job.data.sessionId)

  // Read original file from storage
  const fileBuffer = await storageService.readFile(filePath)

  // Get original image metadata
  const originalImage = sharp(fileBuffer)
  const metadata = await originalImage.metadata()

  if (!metadata.width || !metadata.height) {
    throw new NonRetryableJobError('Could not read image dimensions')
  }

  const originalDimensions = {
    width: metadata.width,
    height: metadata.height,
  }

  await publishJobProgress(job.id!, 30, documentId, job.data.sessionId)

  // Generate thumbnails in parallel
  const thumbnailPromises = Object.entries(THUMBNAIL_SIZES).map(async ([size, width]) => {
    const resized = await sharp(fileBuffer)
      .resize(width, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()

    // Store thumbnail
    const thumbnailPath = `thumbnails/${documentId}/${size}.webp`
    await storageService.writeFile(thumbnailPath, resized)

    return { size, path: thumbnailPath }
  })

  const thumbnails = await Promise.all(thumbnailPromises)

  await publishJobProgress(job.id!, 70, documentId, job.data.sessionId)

  // Generate blurhash from smallest thumbnail
  const smallThumbnailBuffer = await sharp(fileBuffer)
    .resize(32, 32, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const blurhash = encode(
    new Uint8ClampedArray(smallThumbnailBuffer.data),
    smallThumbnailBuffer.info.width,
    smallThumbnailBuffer.info.height,
    4,
    3
  )

  await publishJobProgress(job.id!, 90, documentId, job.data.sessionId)

  // Build result
  const paths = thumbnails.reduce(
    (acc, { size, path }) => {
      acc[size as keyof typeof THUMBNAIL_SIZES] = path
      return acc
    },
    {} as { sm: string; md: string; lg: string }
  )

  const result: ThumbnailJobResult = {
    blurhash,
    paths,
    originalDimensions,
  }

  // Update document with thumbnail info
  await db
    .updateTable('documents')
    .set({
      thumbnail_status: 'complete',
      thumbnail_blurhash: blurhash,
      thumbnail_paths: paths,
      width: originalDimensions.width,
      height: originalDimensions.height,
    })
    .where('id', '=', documentId)
    .execute()

  logger.info('Thumbnail job completed', { documentId, blurhash: blurhash.substring(0, 10) + '...' })

  return result
}

/**
 * Create and start the thumbnail worker
 */
export function createThumbnailWorker(): Worker<ThumbnailJobData, ThumbnailJobResult> {
  const worker = new Worker<ThumbnailJobData, ThumbnailJobResult>(
    QUEUE_NAMES.THUMBNAIL,
    async (job) => processJobWithTracking(job, processThumbnailJob),
    {
      connection: getRedisConnectionOptions(),
      concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.THUMBNAIL],
    }
  )

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id })
  })

  worker.on('failed', (job, error) => {
    logger.error('Job failed', error, { jobId: job?.id })
  })

  worker.on('error', (error) => {
    logger.error('Worker error', error)
  })

  logger.info('Thumbnail worker started', { concurrency: QUEUE_CONCURRENCY[QUEUE_NAMES.THUMBNAIL] })

  return worker
}

// Run as standalone if executed directly
if (require.main === module) {
  createThumbnailWorker()
}

