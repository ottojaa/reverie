import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { LlmMetadata } from '../llm/types';

/** Row builders for the integration tests. Each returns the new id. */

export interface SeedDocument {
    userId: string;
    name: string;
    folderId?: string | null;
    mime?: string;
    category?: string | null;
    extractedDate?: Date | null;
    deleted?: boolean;
    /** SHA-256 stored as file_hash; random when not given. */
    hash?: string;
    ocrText?: string;
    summary?: string;
    entities?: string[];
    tags?: string[];
    photo?: { takenAt?: Date | null; latitude?: number | null; longitude?: number | null; city?: string | null; country?: string | null };
}

export async function seedUser(db: Kysely<Database>, label: string): Promise<string> {
    const row = await db
        .insertInto('users')
        .values({
            email: label + '@example.test',
            display_name: label,
            password_hash: 'x',
            google_id: null,
            storage_quota_bytes: 1_000_000,
            storage_path: '/' + label,
            last_login_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    return row.id;
}

export async function seedFolder(
    db: Kysely<Database>,
    userId: string,
    name: string,
    opts: { parent?: { id: string; path: string }; isPrivate?: boolean; deleted?: boolean } = {},
): Promise<{ id: string; path: string }> {
    const path = (opts.parent?.path ?? '') + '/' + name;
    const row = await db
        .insertInto('folders')
        .values({
            user_id: userId,
            name,
            path,
            parent_id: opts.parent?.id ?? null,
            description: null,
            emoji: null,
            sort_order: 0,
            type: opts.parent ? 'folder' : 'collection',
            is_private: opts.isPrivate ?? false,
            deleted_at: opts.deleted ? new Date() : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    return { id: row.id, path };
}

export async function seedDocument(db: Kysely<Database>, doc: SeedDocument): Promise<string> {
    const row = await db
        .insertInto('documents')
        .values({
            user_id: doc.userId,
            folder_id: doc.folderId ?? null,
            file_path: '/files/' + doc.name,
            file_hash: doc.hash ?? crypto.randomUUID(),
            original_filename: doc.name,
            mime_type: doc.mime ?? 'application/pdf',
            size_bytes: 100,
            width: null,
            height: null,
            duration_seconds: null,
            thumbnail_blurhash: null,
            thumbnail_paths: null,
            document_category: doc.category ?? null,
            extracted_date: doc.extractedDate ?? null,
            ocr_status: 'complete',
            thumbnail_status: 'complete',
            llm_status: 'complete',
            has_meaningful_text: doc.ocrText !== undefined,
            search_vector: null,
            deleted_at: doc.deleted ? new Date() : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    const id = row.id;

    if (doc.ocrText !== undefined) {
        await db
            .insertInto('ocr_results')
            .values({ document_id: id, raw_text: doc.ocrText, confidence_score: 0.9, text_density: null, metadata: null, text_vector: null, duration_ms: null })
            .execute();
    }

    if (doc.summary !== undefined) {
        const metadata: LlmMetadata = {
            type: 'text_summary',
            entities: (doc.entities ?? []).map((name) => ({ type: 'other', canonical_name: name, raw_text: name })),
            topics: [],
        };

        await db
            .insertInto('llm_results')
            .values({ document_id: id, summary: doc.summary, metadata, token_count: null, processing_type: null, duration_ms: null })
            .execute();
    }

    if (doc.photo) {
        await db
            .insertInto('photo_metadata')
            .values({
                document_id: id,
                latitude: doc.photo.latitude ?? null,
                longitude: doc.photo.longitude ?? null,
                country: doc.photo.country ?? null,
                city: doc.photo.city ?? null,
                taken_at: doc.photo.takenAt ?? null,
            })
            .execute();
    }

    for (const tag of doc.tags ?? []) await db.insertInto('document_tags').values({ document_id: id, tag, source: 'user' }).execute();

    await sql`SELECT rebuild_document_search_vector(${id}::uuid)`.execute(db);

    return id;
}
