import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/schema';

/**
 * Removing a tag that names one of the owner's taught labels puts the image on that label's exclusion list, so
 * the label is never put back by a later pass. Keyed on the tag text, not the row's source: an image whose
 * existing `user` or `auto` tag was removed would otherwise be handed the label again as a taught tag.
 */

type Conn = Kysely<Database>;

export interface Exclusion {
    label_id: string;
    document_id: string;
}

/** The owner's labels named by these tags, per document: what would be excluded, and which of those images are the label's examples. */
export async function planExclusions(
    conn: Conn,
    userId: string,
    removals: { document_id: string; tag: string }[],
): Promise<{ exclusions: Exclusion[]; examples: { name: string; document_id: string }[] }> {
    if (removals.length === 0) return { exclusions: [], examples: [] };

    const names = Array.from(new Set(removals.map((removal) => removal.tag.toLowerCase())));
    const labels = await conn
        .selectFrom('taught_labels')
        .select(['id', 'name'])
        .where('user_id', '=', userId)
        .where(sql<boolean>`name = ANY(${names}::text[])`)
        .execute();
    const byName = new Map(labels.map((label) => [label.name, label.id]));
    const pairs = removals.flatMap((removal) => {
        const labelId = byName.get(removal.tag.toLowerCase());

        return labelId ? [{ label_id: labelId, document_id: removal.document_id }] : [];
    });

    if (pairs.length === 0) return { exclusions: [], examples: [] };

    const labelIds = Array.from(new Set(pairs.map((pair) => pair.label_id)));
    const documentIds = Array.from(new Set(pairs.map((pair) => pair.document_id)));
    const [existing, exampleRows] = await Promise.all([
        conn
            .selectFrom('taught_label_exclusions')
            .select(['label_id', 'document_id'])
            .where('label_id', 'in', labelIds)
            .where('document_id', 'in', documentIds)
            .execute(),
        conn
            .selectFrom('taught_label_examples')
            .select(['label_id', 'document_id'])
            .where('label_id', 'in', labelIds)
            .where('document_id', 'in', documentIds)
            .execute(),
    ]);
    const key = (row: Exclusion) => row.label_id + '\0' + row.document_id;
    const already = new Set(existing.map(key));
    const exampleKeys = new Set(exampleRows.map(key));
    const nameOf = new Map(labels.map((label) => [label.id, label.name]));

    return {
        exclusions: pairs.filter((pair) => !already.has(key(pair))),
        examples: pairs.filter((pair) => exampleKeys.has(key(pair))).map((pair) => ({ name: nameOf.get(pair.label_id)!, document_id: pair.document_id })),
    };
}

export async function deleteExclusions(conn: Conn, exclusions: Exclusion[]): Promise<void> {
    for (const { label_id, document_id } of exclusions) {
        await conn.deleteFrom('taught_label_exclusions').where('label_id', '=', label_id).where('document_id', '=', document_id).execute();
    }
}
