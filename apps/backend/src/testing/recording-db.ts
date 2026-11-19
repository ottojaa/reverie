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
}

class RecordingDriver extends DummyDriver {
    constructor(private readonly statements: string[]) {
        super();
    }

    override async acquireConnection(): Promise<DatabaseConnection> {
        const statements = this.statements;

        return {
            async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
                statements.push(compiled.sql);

                return { rows: [] };
            },
            // eslint-disable-next-line require-yield
            async *streamQuery() {
                throw new Error('Streaming is not supported by the recording db');
            },
        };
    }
}

export function createRecordingDb(): RecordingDb {
    const statements: string[] = [];
    const db = new Kysely<Database>({
        dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new RecordingDriver(statements),
            createIntrospector: (kysely) => new PostgresIntrospector(kysely),
            createQueryCompiler: () => new PostgresQueryCompiler(),
        },
    });

    return { db, statements };
}
