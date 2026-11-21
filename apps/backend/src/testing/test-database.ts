import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, Migrator, PostgresDialect, sql, type Migration, type MigrationProvider } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../db/schema';

/**
 * A real Postgres for tests that must prove what a query does or does not return (locked and
 * trashed items, transactions, row locks). The real migrations run against it, so the schema,
 * the search-vector function and the partial unique indexes are the production ones.
 *
 * Where it comes from, first match wins:
 * 1. `TEST_DATABASE_URL`: a server to create a throwaway database on (e.g. `docker compose up postgres`);
 * 2. a throwaway cluster started from an `initdb` on PATH or in a Homebrew/Postgres.app install.
 * Either way the server needs the pgvector extension (migration 017 creates it): the Postgres image in
 * `docker/postgres` has it. `createTestDatabase` checks `pg_available_extensions` first and fails with a
 * message saying so, rather than with a bare `extension "vector" is not available` from inside a migration.
 * With neither, `createTestDatabase` throws: a silently skipped suite would let a privacy regression
 * through the gate. `SKIP_DB_TESTS=1` turns those suites into no-ops on purpose.
 */

export interface TestDatabase {
    db: Kysely<Database>;
    close: () => Promise<void>;
}

const MIGRATIONS_DIR = join(__dirname, '../db/migrations');

/** The real migration files, loaded through the test runner so their TypeScript needs no build. */
const provider: MigrationProvider = {
    async getMigrations() {
        const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
        const entries = await Promise.all(
            files.map(async (file) => [file.replace(/\.ts$/, ''), (await import(join(MIGRATIONS_DIR, file))) as Migration] as const),
        );

        return Object.fromEntries(entries);
    },
};

async function migrate(db: Kysely<Database>): Promise<void> {
    const { error } = await new Migrator({ db, provider }).migrateToLatest();

    if (error) throw error;
}

function toKysely(connectionString: string): Kysely<Database> {
    return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 4 }) }) });
}

function findPostgresBinDir(): string | null {
    const candidates = ['/opt/homebrew/opt', '/usr/local/opt', '/Applications/Postgres.app/Contents/Versions']
        .filter((dir) => existsSync(dir))
        .flatMap((dir) => readdirSync(dir).map((entry) => join(dir, entry, dir.includes('Postgres.app') ? 'bin' : 'bin')))
        .filter((bin) => existsSync(join(bin, 'initdb')));
    const onPath = spawnSync('which', ['initdb'], { encoding: 'utf8' });

    if (onPath.status === 0) return join(onPath.stdout.trim(), '..');

    return candidates.sort().at(-1) ?? null;
}

async function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();

        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();

            server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port'))));
        });
    });
}

async function startCluster(binDir: string): Promise<{ url: string; stop: () => void }> {
    const dir = mkdtempSync(join(tmpdir(), 'reverie-test-pg-'));
    const port = await findFreePort();
    const bin = (name: string) => join(binDir, name);

    execFileSync(bin('initdb'), ['-D', dir, '-U', 'postgres', '--auth=trust', '--no-sync'], { stdio: 'ignore' });
    // TCP only and no unix socket: a socket path under a long temp dir can exceed the OS limit.
    execFileSync(bin('pg_ctl'), ['-D', dir, '-w', '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c fsync=off`, 'start'], {
        stdio: 'ignore',
    });

    return {
        url: `postgres://postgres@127.0.0.1:${port}/postgres`,
        stop: () => {
            spawnSync(bin('pg_ctl'), ['-D', dir, '-m', 'immediate', 'stop'], { stdio: 'ignore' });
            rmSync(dir, { recursive: true, force: true });
        },
    };
}

async function createScratchDatabase(adminUrl: string): Promise<{ url: string; drop: () => Promise<void> }> {
    const name = 'reverie_test_' + Math.random().toString(36).slice(2, 10);
    const admin = toKysely(adminUrl);

    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);

    const url = new URL(adminUrl);

    url.pathname = '/' + name;

    return {
        url: url.toString(),
        drop: async () => {
            await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
            await admin.destroy();
        },
    };
}

/** Fails clearly when the server has no pgvector, which every test database needs. */
export async function assertVectorExtension(db: Kysely<Database>): Promise<void> {
    const { rows } = await sql<{ name: string }>`SELECT name FROM pg_available_extensions WHERE name = 'vector'`.execute(db);

    if (rows.length > 0) return;

    throw new Error(
        'The test Postgres has no pgvector extension: point TEST_DATABASE_URL at the compose postgres (docker compose up -d postgres, ' +
            'built from docker/postgres) or install pgvector for the Postgres that initdb comes from. SKIP_DB_TESTS=1 skips these suites on purpose.',
    );
}

export async function createTestDatabase(): Promise<TestDatabase> {
    const adminUrl = process.env['TEST_DATABASE_URL'];
    const binDir = adminUrl ? null : findPostgresBinDir();

    if (!adminUrl && !binDir) throw new Error('No Postgres for the database tests: set TEST_DATABASE_URL, put initdb on PATH, or set SKIP_DB_TESTS=1');

    const cluster = binDir ? await startCluster(binDir) : null;
    const scratch = await createScratchDatabase(cluster?.url ?? adminUrl!);
    const db = toKysely(scratch.url);

    try {
        await assertVectorExtension(db);
        await migrate(db);
    } catch (error) {
        await db.destroy();
        await scratch.drop();
        cluster?.stop();

        throw error;
    }

    return {
        db,
        close: async () => {
            await db.destroy();
            await scratch.drop();
            cluster?.stop();
        },
    };
}

/**
 * Stand-in for `db/kysely` in `vi.mock`: forwards to whichever test database is current, so the
 * mock can be registered before the database exists.
 */
export function createDbProxy(): { db: Kysely<Database>; use: (db: Kysely<Database>) => void } {
    let current: Kysely<Database> | undefined;
    const db = new Proxy({} as Kysely<Database>, {
        get(_target, property) {
            if (!current) throw new Error('Test database is not ready');

            const value = Reflect.get(current, property, current) as unknown;

            if (typeof value !== 'function') return value;

            // `db.fn` is a callable that also carries `countAll`, `sum`, ...; binding alone would drop those.
            return Object.assign(value.bind(current), value);
        },
    });

    return { db, use: (next) => (current = next) };
}
