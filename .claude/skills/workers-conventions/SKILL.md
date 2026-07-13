---
name: workers-conventions
description: BullMQ worker conventions — worker structure, publishing started/progress/complete/failed job events to Redis pub/sub, retry policy, and concurrency config. Load before writing or reviewing code under `apps/backend/src/workers` or `apps/backend/src/queues`, or when adding a background job.
---

# Workers (BullMQ)

Background job processors for OCR, thumbnails, and LLM operations.

## Worker Structure

```typescript
import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues/redis';
import { publishJobEvent } from './worker.utils';

const worker = new Worker<OcrJobData>(
    'ocr-queue',
    async (job: Job<OcrJobData>) => {
        await publishJobEvent({
            type: 'job:started',
            job_id: job.id!,
            document_id: job.data.documentId,
            status: 'processing',
        });

        try {
            const result = await processOcr(job.data);

            await publishJobEvent({
                type: 'job:complete',
                job_id: job.id!,
                status: 'complete',
                result,
            });

            return result;
        } catch (error) {
            await publishJobEvent({
                type: 'job:failed',
                job_id: job.id!,
                status: 'failed',
                error_message: error.message,
            });
            throw error;
        }
    },
    { connection: redisConnection, concurrency: 2 },
);
```

## Job Types

- `ocr-queue`: Text extraction from images (Tesseract)
- `thumbnail-queue`: Image resizing + blurhash generation (Sharp)
- `llm-queue`: Document summarization (OpenAI)

## Real-time Updates

Workers publish events to Redis pub/sub, forwarded to clients via WebSocket:

```typescript
await publishJobEvent({
    type: 'job:progress',
    job_id: job.id,
    progress: 50,
    status: 'processing',
});
```

## Error Handling

- Retryable: Network failures, temporary storage issues
- Non-retryable: Invalid file format, missing document
- Use `job.attemptsMade` to track retries
- Exponential backoff configured in queue options

## Configuration

Environment variables:

```
JOB_CONCURRENCY_OCR=2
JOB_CONCURRENCY_THUMBNAIL=4
JOB_CONCURRENCY_LLM=1
JOB_RETRY_ATTEMPTS=3
```
