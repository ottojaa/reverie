import { sql, type Kysely } from 'kysely';
import type { Database, TaughtLabel } from '../db/schema';
import { excludePrivateDocuments } from '../services/privacy';

type Conn = Kysely<Database>;

export async function loadLabels(conn: Conn, userId: string): Promise<TaughtLabel[]> {
    return conn.selectFrom('taught_labels').selectAll().where('user_id', '=', userId).orderBy('name').execute();
}

export async function loadLabel(conn: Conn, userId: string, labelId: string): Promise<TaughtLabel | undefined> {
    return conn.selectFrom('taught_labels').selectAll().where('id', '=', labelId).where('user_id', '=', userId).executeTakeFirst();
}

export async function loadLabelByName(conn: Conn, userId: string, name: string): Promise<TaughtLabel | undefined> {
    return conn.selectFrom('taught_labels').selectAll().where('user_id', '=', userId).where('name', '=', name).executeTakeFirst();
}

export async function insertLabel(conn: Conn, userId: string, name: string, threshold: number): Promise<TaughtLabel> {
    return conn.insertInto('taught_labels').values({ user_id: userId, name, threshold }).returningAll().executeTakeFirstOrThrow();
}

export async function updateThreshold(conn: Conn, labelId: string, threshold: number, isCustom: boolean): Promise<void> {
    await conn.updateTable('taught_labels').set({ threshold, threshold_is_custom: isCustom, updated_at: new Date() }).where('id', '=', labelId).execute();
}

/** Adds examples and lifts them off the exclusion list (teaching an image is the opposite of excluding it). Returns how many are new. */
export async function addExamples(conn: Conn, labelId: string, documentIds: string[]): Promise<number> {
    await conn.deleteFrom('taught_label_exclusions').where('label_id', '=', labelId).where('document_id', 'in', documentIds).execute();

    const inserted = await conn
        .insertInto('taught_label_examples')
        .values(documentIds.map((document_id) => ({ label_id: labelId, document_id })))
        .onConflict((oc) => oc.doNothing())
        .returning('document_id')
        .execute();

    return inserted.length;
}

export async function removeExample(conn: Conn, labelId: string, documentId: string): Promise<boolean> {
    const result = await conn.deleteFrom('taught_label_examples').where('label_id', '=', labelId).where('document_id', '=', documentId).executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
}

/** Ids of the label's examples that are live. */
export async function loadLiveExampleIds(conn: Conn, labelId: string): Promise<string[]> {
    const rows = await conn
        .selectFrom('taught_label_examples as ex')
        .innerJoin('documents as d', 'd.id', 'ex.document_id')
        .select('ex.document_id')
        .where('ex.label_id', '=', labelId)
        .where('d.deleted_at', 'is', null)
        .execute();

    return rows.map((row) => row.document_id);
}

/** Documents of this owner that are images (their thumbnail is what gets embedded) among `ids`. */
export async function loadOwnedImageIds(conn: Conn, userId: string, ids: string[]): Promise<string[]> {
    const rows = await conn
        .selectFrom('documents')
        .select('id')
        .where('user_id', '=', userId)
        .where('id', 'in', ids)
        .where('deleted_at', 'is', null)
        .where('mime_type', 'like', 'image/%')
        .execute();

    return rows.map((row) => row.id);
}

export async function addExclusions(conn: Conn, rows: { label_id: string; document_id: string }[]): Promise<{ label_id: string; document_id: string }[]> {
    if (rows.length === 0) return [];

    return conn
        .insertInto('taught_label_exclusions')
        .values(rows)
        .onConflict((oc) => oc.doNothing())
        .returning(['label_id', 'document_id'])
        .execute();
}

/** The label's current matches as the owner sees them: live images outside private folders that carry its taught tag and aren't examples. */
export async function loadVisibleMatchIds(conn: Conn, label: TaughtLabel, privateFolderIds: string[]): Promise<string[]> {
    let query = conn
        .selectFrom('document_tags as t')
        .innerJoin('documents as d', 'd.id', 't.document_id')
        .select('t.document_id')
        .where('t.tag', '=', label.name)
        .where('t.source', '=', 'taught')
        .where('d.user_id', '=', label.user_id)
        .where('d.deleted_at', 'is', null)
        .where(({ not, exists, selectFrom }) =>
            not(
                exists(
                    selectFrom('taught_label_examples as me')
                        .select('me.document_id')
                        .whereRef('me.document_id', '=', 'd.id')
                        .where('me.label_id', '=', label.id),
                ),
            ),
        );

    query = excludePrivateDocuments(query, privateFolderIds, 'd.');

    return (await query.orderBy('t.document_id').execute()).map((row) => row.document_id);
}

/** Per label (of this owner): how many examples and taught matches are visible to them. */
export async function countVisible(conn: Conn, userId: string, privateFolderIds: string[]): Promise<Map<string, { examples: number; matches: number }>> {
    const counts = new Map<string, { examples: number; matches: number }>();
    const visible = <T>(query: T) => excludePrivateDocuments(query, privateFolderIds, 'd.');
    const examples = await visible(
        conn
            .selectFrom('taught_label_examples as ex')
            .innerJoin('taught_labels as l', 'l.id', 'ex.label_id')
            .innerJoin('documents as d', 'd.id', 'ex.document_id')
            .select(['ex.label_id', sql<number>`count(*)::int`.as('n')])
            .where('l.user_id', '=', userId)
            .where('d.deleted_at', 'is', null)
            .groupBy('ex.label_id'),
    ).execute();
    const matches = await visible(
        conn
            .selectFrom('taught_labels as l')
            .innerJoin('document_tags as t', (join) => join.onRef('t.tag', '=', 'l.name').on('t.source', '=', 'taught'))
            .innerJoin('documents as d', (join) => join.onRef('d.id', '=', 't.document_id').onRef('d.user_id', '=', 'l.user_id'))
            .select(['l.id as label_id', sql<number>`count(*)::int`.as('n')])
            .where('l.user_id', '=', userId)
            .where('d.deleted_at', 'is', null)
            .where(({ not, exists, selectFrom }) =>
                not(
                    exists(
                        selectFrom('taught_label_examples as me')
                            .select('me.document_id')
                            .whereRef('me.document_id', '=', 'd.id')
                            .whereRef('me.label_id', '=', 'l.id'),
                    ),
                ),
            )
            .groupBy('l.id'),
    ).execute();

    for (const row of examples) counts.set(row.label_id, { examples: row.n, matches: 0 });

    for (const row of matches) counts.set(row.label_id, { examples: counts.get(row.label_id)?.examples ?? 0, matches: row.n });

    return counts;
}

/** A document's tags with where each came from; a taught tag carries the id of the owner's label that put it there. */
export async function loadDocumentTags(
    conn: Conn,
    userId: string,
    documentId: string,
): Promise<{ name: string; source: 'user' | 'auto' | 'taught'; label_id: string | null }[]> {
    const rows = await conn
        .selectFrom('document_tags as t')
        .leftJoin('taught_labels as l', (join) => join.onRef('l.name', '=', 't.tag').on('l.user_id', '=', userId).on('t.source', '=', 'taught'))
        .select(['t.tag', 't.source', 'l.id as label_id'])
        .where('t.document_id', '=', documentId)
        .orderBy('t.tag')
        .execute();

    return rows.map((row) => ({ name: row.tag, source: row.source, label_id: row.label_id }));
}
