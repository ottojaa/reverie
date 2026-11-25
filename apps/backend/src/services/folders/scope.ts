import { sql, type RawBuilder, type SqlBool } from 'kysely';

/**
 * Folder filters as SQL, for queries over a user's documents or folders: each one matches some folders and
 * everything beneath them. Nothing here knows about locks, so a caller excludes private content as it
 * would without the filter.
 */

/** The ids of the user's live folders matching `roots` (over the alias `root`), and of every folder beneath them. */
function subtreeIdsSql(userId: string, roots: RawBuilder<SqlBool>[]): RawBuilder<string> {
    // UNION, not UNION ALL: a parent loop in bad data then ends the recursion.
    return sql<string>`(
        WITH RECURSIVE subtree AS (
            SELECT root.id FROM folders root
            WHERE root.user_id = ${userId} AND root.deleted_at IS NULL AND (${sql.join(roots, sql` OR `)})
            UNION
            SELECT child.id FROM folders child JOIN subtree ON child.parent_id = subtree.id
        )
        SELECT id FROM subtree
    )`;
}

/** A `folder:` value names folders by their whole path (leading '/') or by their name, ignoring case. */
function toNamedRoot(value: string): RawBuilder<SqlBool> {
    const column = sql.ref(value.startsWith('/') ? 'root.path' : 'root.name');

    return sql<SqlBool>`lower(${column}) = lower(${value})`;
}

/** Whether a folder's path is one a `folder:` value names. The same rule as the SQL filter. */
export function isNamedBy(path: string, value: string): boolean {
    const named = value.startsWith('/') ? path : path.slice(path.lastIndexOf('/') + 1);

    return named.toLowerCase() === value.toLowerCase();
}

/** `column` is a folder named by one of `values`, or beneath one. */
export function inNamedFoldersSql(column: string, userId: string, values: string[]): RawBuilder<SqlBool> {
    return sql<SqlBool>`${sql.ref(column)} IN ${subtreeIdsSql(userId, values.map(toNamedRoot))}`;
}

/** The opposite, true for what is in no folder at all. */
export function outsideNamedFoldersSql(column: string, userId: string, values: string[]): RawBuilder<SqlBool> {
    return sql<SqlBool>`(${sql.ref(column)} IS NULL OR ${sql.ref(column)} NOT IN ${subtreeIdsSql(userId, values.map(toNamedRoot))})`;
}

/** `column` is the folder `folderId` or beneath it; true for every row when no folder is given. */
export function withinFolderSql(column: string, userId: string, folderId: string | undefined): RawBuilder<SqlBool> {
    if (folderId === undefined) return sql<SqlBool>`TRUE`;

    return sql<SqlBool>`${sql.ref(column)} IN ${subtreeIdsSql(userId, [sql<SqlBool>`root.id = ${folderId}`])}`;
}
