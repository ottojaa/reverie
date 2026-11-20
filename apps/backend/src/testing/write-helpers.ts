import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';

/** Everything a write tool can change, in a comparable form, so a test can show nothing moved. */
export async function snapshotLibrary(db: Kysely<Database>): Promise<unknown> {
    const documents = await db.selectFrom('documents').select(['id', 'folder_id', 'original_filename', 'deleted_at']).orderBy('id').execute();
    const folders = await db.selectFrom('folders').select(['id', 'name', 'path', 'parent_id', 'is_private', 'deleted_at']).orderBy('id').execute();
    const tags = await db.selectFrom('document_tags').select(['document_id', 'tag', 'source']).orderBy('document_id').orderBy('tag').execute();
    const audit = await db.selectFrom('tool_audit_log').select(['id', 'undone_at']).orderBy('id').execute();

    return { documents, folders, tags, audit };
}

export async function loadAudit(db: Kysely<Database>, userId: string) {
    return db.selectFrom('tool_audit_log').selectAll().where('user_id', '=', userId).orderBy('created_at').orderBy('id').execute();
}

export async function loadTagNames(db: Kysely<Database>, documentId: string): Promise<string[]> {
    const rows = await db.selectFrom('document_tags').select('tag').where('document_id', '=', documentId).orderBy('tag').execute();

    return rows.map((row) => row.tag);
}
