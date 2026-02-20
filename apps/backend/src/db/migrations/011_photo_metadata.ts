import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .createTable('photo_metadata')
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('document_id', 'uuid', (col) => col.notNull().unique().references('documents.id').onDelete('cascade'))
        .addColumn('latitude', 'real')
        .addColumn('longitude', 'real')
        .addColumn('country', 'text')
        .addColumn('city', 'text')
        .addColumn('taken_at', 'timestamptz')
        .addColumn('processed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute();

    await sql`CREATE INDEX idx_photo_metadata_country ON photo_metadata(country)`.execute(db);
    await sql`CREATE INDEX idx_photo_metadata_city ON photo_metadata(city)`.execute(db);
    await sql`CREATE INDEX idx_photo_metadata_taken_at ON photo_metadata(taken_at)`.execute(db);
    await sql`CREATE INDEX idx_photo_metadata_location ON photo_metadata(country, city)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('photo_metadata').execute();
}
