import { promises as fs } from 'fs'
import {
    FileMigrationProvider,
    Kysely,
    Migrator,
    PostgresDialect,
} from 'kysely'
import * as path from 'path'
import { Pool } from 'pg'
import type { Database } from './schema'

async function migrateToLatest() {
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env.DATABASE_URL,
      }),
    }),
  })

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  })

  const direction = process.argv[2]

  if (direction === 'down') {
    const { error, results } = await migrator.migrateDown()

    results?.forEach((it) => {
      if (it.status === 'Success') {
        console.log(`✅ Migration "${it.migrationName}" rolled back successfully`)
      } else if (it.status === 'Error') {
        console.error(`❌ Failed to rollback migration "${it.migrationName}"`)
      }
    })

    if (error) {
      console.error('Failed to rollback')
      console.error(error)
      process.exit(1)
    }
  } else {
    const { error, results } = await migrator.migrateToLatest()

    results?.forEach((it) => {
      if (it.status === 'Success') {
        console.log(`✅ Migration "${it.migrationName}" executed successfully`)
      } else if (it.status === 'Error') {
        console.error(`❌ Failed to execute migration "${it.migrationName}"`)
      }
    })

    if (error) {
      console.error('Failed to migrate')
      console.error(error)
      process.exit(1)
    }
  }

  await db.destroy()
}

migrateToLatest()



