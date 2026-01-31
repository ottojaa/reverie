import { config } from 'dotenv';
import { join } from 'path';
import { z } from 'zod';

// Load .env from repo root (path relative to this file so it works from any cwd)
config({ path: join(__dirname, '../../../../.env') });

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

    // OpenAI / LLM
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_TEMPERATURE: z.coerce.number().default(0.3),
    OPENAI_MAX_TOKENS: z.coerce.number().default(1000),

    // LLM Processing
    LLM_ENABLED: z.coerce.boolean().default(true),
    LLM_MAX_INPUT_CHARS: z.coerce.number().default(50000),
    LLM_SNIPPET_SIZE: z.coerce.number().default(5000),
    LLM_PROCESS_CODE_FILES: z.coerce.boolean().default(false),
    LLM_MIN_OCR_CONFIDENCE: z.coerce.number().default(30),

    // LLM Vision (optional)
    LLM_VISION_ENABLED: z.coerce.boolean().default(false),
    LLM_VISION_MODEL: z.string().default('gpt-4o'),

    // CORS (HTTP API)
    CORS_ORIGIN: z.string().url().default('http://localhost:4200'),

    // WebSocket
    WS_ENABLED: z.coerce.boolean().default(true),
    WS_CORS_ORIGIN: z.string().default('http://localhost:5173'),

    // Job Queue
    JOB_CONCURRENCY_OCR: z.coerce.number().default(2),
    JOB_CONCURRENCY_THUMBNAIL: z.coerce.number().default(4),
    JOB_CONCURRENCY_LLM: z.coerce.number().default(1),
    JOB_RETRY_ATTEMPTS: z.coerce.number().default(3),
    JOB_RETRY_BACKOFF_MS: z.coerce.number().default(5000),

    // JWT Authentication
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES: z.string().default('15m'),
    JWT_REFRESH_EXPIRES: z.string().default('7d'),

    // Google OAuth (optional)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        console.error(result.error.format());
        process.exit(1);
    }

    return result.data;
}

export const env = validateEnv();
