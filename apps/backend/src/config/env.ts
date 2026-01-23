import { config } from 'dotenv'
import { z } from 'zod'

// Load .env file from project root
config({ path: '../../.env' })

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // Storage
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./uploads'),

  // S3 (optional)
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_ENDPOINT: z.string().optional(),
  STORAGE_S3_REGION: z.string().default('us-east-1'),
  STORAGE_S3_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_SECRET_KEY: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // WebSocket
  WS_ENABLED: z.coerce.boolean().default(true),
  WS_CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Job Queue
  JOB_CONCURRENCY_OCR: z.coerce.number().default(2),
  JOB_CONCURRENCY_THUMBNAIL: z.coerce.number().default(4),
  JOB_CONCURRENCY_LLM: z.coerce.number().default(1),
  JOB_RETRY_ATTEMPTS: z.coerce.number().default(3),
  JOB_RETRY_BACKOFF_MS: z.coerce.number().default(5000),
})

export type Env = z.infer<typeof envSchema>

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    console.error('❌ Invalid environment variables:')
    console.error(result.error.format())
    process.exit(1)
  }

  return result.data
}

export const env = validateEnv()


