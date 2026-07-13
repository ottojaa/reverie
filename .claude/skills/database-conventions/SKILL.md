---
name: database-conventions
description: PostgreSQL + Kysely conventions — schema types in db/schema.ts, type-safe select/insert/transaction patterns, Kysely migrations, and tsvector full-text search. Load before writing or reviewing any code under `apps/backend/src/db`, or when working on queries or migrations.
---

# Database Layer (Kysely + PostgreSQL)

Type-safe SQL queries with Kysely and PostgreSQL full-text search.

## Schema Definition

Types in `db/schema.ts` match PostgreSQL tables exactly:

```typescript
interface Database {
  folders: FolderTable
  documents: DocumentTable
  ocr_results: OcrResultTable
  processing_jobs: ProcessingJobTable
}

interface DocumentTable {
  id: string
  folder_id: string
  file_path: string
  // ... all columns with correct types
}
```

## Query Patterns

```typescript
import { db } from './kysely'

// Select with type safety
const doc = await db
  .selectFrom('documents')
  .where('id', '=', documentId)
  .selectAll()
  .executeTakeFirst()

// Insert returning
const newDoc = await db
  .insertInto('documents')
  .values({ ... })
  .returningAll()
  .executeTakeFirstOrThrow()

// Transaction
await db.transaction().execute(async (trx) => {
  await trx.insertInto('documents').values(...).execute()
  await trx.insertInto('processing_jobs').values(...).execute()
})
```

## Migrations

Located in `db/migrations/`. Use Kysely's migration format:

```typescript
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('table_name')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('table_name').execute()
}
```

## Full-Text Search

Use PostgreSQL tsvector for search:

```typescript
// Query with tsquery
const results = await db
  .selectFrom('ocr_results')
  .where(sql`text_vector @@ plainto_tsquery('english', ${query})`)
  .execute()
```
