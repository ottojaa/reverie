import {
    DummyDriver,
    Kysely,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
    type CompiledQuery,
    type DatabaseConnection,
    type QueryResult,
} from 'kysely';
import type { Database } from '../db/schema';

/**
 * A Kysely instance that runs nothing: it records the SQL of every statement it is given and
 * answers with no rows. Lets tests run real service code DB-less and then inspect the queries.
 */
export interface RecordingDb {
    db: Kysely<Database>;
    statements: string[];
    /** Bound parameters of each statement, same index as `statements`. */
    parameters: (readonly unknown[])[];
    /** Set to answer statements with canned rows; unset (or returning undefined) means no rows. */
    respond?: (sql: string) => unknown[] | undefined;
}

class RecordingDriver extends DummyDriver {
    constructor(private readonly recording: () => RecordingDb) {
        super();
    }

    override async acquireConnection(): Promise<DatabaseConnection> {
        const recording = this.recording;

        return {
            async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
                const state = recording();
                state.statements.push(compiled.sql);
                state.parameters.push(compiled.parameters);

                return { rows: (state.respond?.(compiled.sql) ?? []) as R[] };
            },
            // eslint-disable-next-line require-yield
            async *streamQuery() {
                throw new Error('Streaming is not supported by the recording db');
            },
        };
    }
}

export function createRecordingDb(): RecordingDb {
    const recording: RecordingDb = { db: undefined as unknown as Kysely<Database>, statements: [], parameters: [] };

    recording.db = new Kysely<Database>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new RecordingDriver(() => recording),
            createIntrospector: (kysely) => new PostgresIntrospector(kysely),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    return recording;
}
