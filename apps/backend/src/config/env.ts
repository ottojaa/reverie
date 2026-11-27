import { config } from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { z } from 'zod';

// Load the env file from the repo root regardless of cwd or build layout:
// __dirname differs between tsx runs (apps/backend/src/config) and the esbuild
// output (apps/backend/dist/apps/backend/src/config), so walk upward until the
// file is found instead of hardcoding the depth.
// ENV_FILE can override (e.g. .env.prod) when set before import (e.g. create-user --prod)
const envFile = process.env.ENV_FILE || '.env';
const envPath = findUp(envFile, __dirname) ?? join(process.cwd(), envFile);
config({ path: envPath });

function findUp(name: string, from: string): string | undefined {
    let dir = from;

    for (;;) {
        const candidate = join(dir, name);

        if (existsSync(candidate)) return candidate;

        const parent = dirname(dir);

        if (parent === dir) return undefined;

        dir = parent;
    }
}

/**
 * A boolean env flag: `true`/`false`/`1`/`0`, any case. Anything else, including an empty string,
 * fails startup. Never `z.coerce.boolean()`: that is `Boolean(value)`, so "false" and "0" read as true.
 */
function envBoolean(defaultValue: boolean) {
    return z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.enum(['true', 'false', '1', '0']))
        .transform((value) => value === 'true' || value === '1')
        .optional()
        .transform((value) => value ?? defaultValue);
}

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

    // OCR Engine
    OCR_ENGINE: z.enum(['paddleocr', 'tesseract']).default('paddleocr'),
    PYTHON_PATH: z.string().default('python3'),
    // PaddleOCR inference device: 'cpu' (default), 'gpu', or 'gpu:0'.
    // Set to 'gpu:0' on a CUDA host; falls back to CPU if GPU init fails.
    OCR_DEVICE: z.string().default('cpu'),

    // Anthropic / LLM
    ANTHROPIC_API_KEY: z.string().optional(),
    // Per-document summarization: high-volume JSON extraction (Claude Haiku 5.5).
    // claude-haiku-4-5 still works as a rollback: effort is simply not sent to it.
    ANTHROPIC_SUMMARY_MODEL: z.string().default('claude-haiku-5-5'),
    // Image description (Claude Haiku 5.5 — has vision, cheap/fast).
    ANTHROPIC_VISION_MODEL: z.string().default('claude-haiku-5-5'),
    // Thinking depth (effort) for summaries and image descriptions. Only sent to
    // models that accept it (Haiku 5.x). Low: per-document extraction needs little
    // reasoning; raise it if spelling of proper nouns turns out worse than before.
    ANTHROPIC_SUMMARY_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),

    // Optional bearer token for a local OpenAI-compatible server (Ollama, llama.cpp, vLLM, LM Studio) that asks for one. The server's URL and
    // model are admin settings; the key stays here, never in the database. A local model is slow, so its requests get a long timeout.
    LOCAL_LLM_API_KEY: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
    LOCAL_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

    // In-app agent: the reverie-agent container (Claude Code, signed in with the admin's own plan).
    // Unset AGENT_URL = no agent configured; the UI then shows it as unavailable.
    AGENT_URL: z.string().url().optional(),
    // The wrapper's shared secret: either inline (dev) or a file the backend creates itself on first use (the wrapper only reads it, from a read-only mount).
    AGENT_SECRET: z.string().min(16).optional(),
    AGENT_SECRET_FILE: z.string().optional(),

    // Local embedding service (reverie-ml). Unset or empty = embeddings off: nothing is queued and no worker starts.
    ML_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
    ML_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    // Backfill of the existing library: documents queued per page, and the pause between pages.
    EMBED_BACKFILL_BATCH: z.coerce.number().int().positive().default(50),
    EMBED_BACKFILL_INTERVAL_MS: z.coerce.number().int().positive().default(20_000),
    /** After the embedding backfill has covered the library it starts over this long later, to pick up images whose embed job gave up. */
    EMBED_RECONCILE_INTERVAL_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(6 * 60 * 60 * 1000),
    // Search by meaning. A document counts as a meaning match when, for its model, its cosine similarity to the query is
    // at least *_MIN_SIMILARITY (a low absolute floor, only there to stop pure noise) and stands out from the query's noise:
    // above the median similarity the query gets across the library by sqrt(2 ln N) + *_MARGIN_Z robust standard deviations,
    // N being the library's embeddings (search/semantic-noise.ts). Raise a margin to drop more, lower it to keep more.
    // Defaults come from the real library: siglip2 image hits 0.10-0.17, bge-m3 plausible hits 0.45-0.66, bge-m3 noise tops out near 0.39.
    // Margins from the probe on it (21 Nov, N = 485 text / 124 image vectors): a no-match query ("lumi talvi") peaked at z 2.3 (text)
    // and 3.2 (image), while relevant hits sat at z 3.5-5.1 (image: evening photos, statement photos) and 4.2+ (text). 1.5 dropped most
    // of them; these put the cut near z 4.0 (text) and 3.5 (image).
    // Each vector stream keeps at most SEMANTIC_TOP_K documents. Embedding the query gets SEMANTIC_TIMEOUT_MS, then search carries on with full text only.
    SEMANTIC_TEXT_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.35),
    SEMANTIC_IMAGE_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.06),
    SEMANTIC_TEXT_MARGIN_Z: z.coerce.number().min(0).default(0.5),
    SEMANTIC_IMAGE_MARGIN_Z: z.coerce.number().min(0).default(0.4),
    SEMANTIC_TOP_K: z.coerce.number().int().positive().default(100),
    SEMANTIC_TIMEOUT_MS: z.coerce.number().int().positive().default(1_500),

    // Near-duplicate detection. Two images are duplicates when their image embeddings reach this cosine similarity; a group needs
    // every pair in it to reach it (no chains). Lowering it needs the backfill to scan again; raising it applies at once.
    // 0.95 comes from SigLIP2 so400m on public photos: re-compressed (q60), halved, lightly cropped and burst-shifted copies score 0.95 or more,
    // unrelated photos top out at 0.87. Same-layout screenshots and document pages score 0.96-0.99 whatever the text, so no threshold separates
    // those from copies: "Not duplicates" is the answer to them. Run the duplicate-probe script on the real library to confirm or move it.
    // Each image stores at most DUPLICATE_MAX_NEIGHBOURS of its nearest matches, so a burst larger than that can split into several groups.
    DUPLICATE_MIN_SIMILARITY: z.coerce.number().min(0.5).max(1).default(0.95),
    DUPLICATE_MAX_NEIGHBOURS: z.coerce.number().int().positive().default(50),

    // LLM Processing
    LLM_ENABLED: envBoolean(true),
    LLM_MAX_INPUT_CHARS: z.coerce.number().default(25000),
    LLM_SNIPPET_SIZE: z.coerce.number().default(3000),
    LLM_PROCESS_CODE_FILES: envBoolean(false),
    LLM_MIN_OCR_CONFIDENCE: z.coerce.number().default(30),
    // Max output tokens for the per-document summary/vision calls.
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().default(2000),

    // LLM Vision (optional)
    LLM_VISION_ENABLED: envBoolean(false),

    // Trash: days a deleted item stays restorable. Fallback for the `trash.retentionDays`
    // server setting (an admin override in the DB wins). Keep the bounds in step with settings/registry.ts.
    TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),

    // CORS (HTTP API)
    CORS_ORIGIN: z.string().url().default('http://localhost:4200'),

    // WebSocket
    WS_ENABLED: envBoolean(true),
    WS_CORS_ORIGIN: z.string().default('http://localhost:5173'),

    // Job Queue
    JOB_CONCURRENCY_OCR: z.coerce.number().default(2),
    JOB_CONCURRENCY_THUMBNAIL: z.coerce.number().default(4),
    /** OCR and thumbnails of background uploads run in their own lanes, which hold back while the normal lane has work. */
    JOB_CONCURRENCY_OCR_BACKGROUND: z.coerce.number().int().positive().default(1),
    JOB_CONCURRENCY_THUMBNAIL_BACKGROUND: z.coerce.number().int().positive().default(1),
    JOB_CONCURRENCY_LLM: z.coerce.number().default(1),
    JOB_CONCURRENCY_TRIM: z.coerce.number().default(2),
    JOB_CONCURRENCY_EMBED: z.coerce.number().int().positive().default(1),
    // One encode at a time: it saturates the CPU or the card's encoder, and the 52-video library is a one-off.
    JOB_CONCURRENCY_TRANSCODE: z.coerce.number().int().positive().default(1),
    /** Videos of background uploads (phone backup) encode in their own lane, beside the normal one. */
    JOB_CONCURRENCY_TRANSCODE_BACKGROUND: z.coerce.number().int().positive().default(1),
    /** `nice` level of a background encode's ffmpeg: higher yields more CPU to the rest of the server. */
    TRANSCODE_BACKGROUND_NICE: z.coerce.number().int().min(0).max(19).default(10),
    /** ffmpeg threads for a background encode: its decoder, its filters and each rung's encoder. */
    TRANSCODE_BACKGROUND_THREADS: z.coerce.number().int().positive().default(2),
    // 'auto' uses NVENC when a test encode works, else libx264; 'cpu' never tries NVENC (the card may be busy, or its encoder unwanted).
    TRANSCODE_ENCODER: z.enum(['auto', 'cpu']).default('auto'),
    TRANSCODE_BACKFILL_BATCH: z.coerce.number().int().positive().default(2),
    TRANSCODE_BACKFILL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
    JOB_RETRY_ATTEMPTS: z.coerce.number().default(3),
    JOB_RETRY_BACKOFF_MS: z.coerce.number().default(5000),

    // JWT Authentication
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES: z.string().default('15m'),
    JWT_REFRESH_EXPIRES: z.string().default('7d'),

    // External sign-in through OpenID Connect (optional). OIDC_PROVIDERS is a JSON array of providers (see oidc/providers.ts);
    // the three GOOGLE_* variables still work and add a `google` provider by themselves.
    OIDC_PROVIDERS: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().url().optional(),
    // Where browsers reach this API; a provider without its own redirectUri gets `<API_PUBLIC_URL>/auth/oidc/<id>/callback`.
    API_PUBLIC_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),

    // File serving (signed URLs)
    FILE_URL_SECRET: z.string().min(32),
    FILE_URL_EXPIRES_SECONDS: z.coerce.number().default(3600),
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
