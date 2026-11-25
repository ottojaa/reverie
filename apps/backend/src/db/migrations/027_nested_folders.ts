import { sql, type Kysely, type RawBuilder } from 'kysely';

/**
 * One kind of folder: a folder holds documents and folders to any depth, and both may sit at the top level.
 * No row moves: collections stay where they are, now ordinary top-level folders.
 *
 * up():
 *  1. Logs an audit of rows the old two-level rules would not have allowed, or that this migration changes.
 *  2. Renames folders so a path can be read back: '/' in a name becomes '-', and of live siblings whose names
 *     differ only in case, all but the oldest get " (2)", " (3)", ...
 *  3. Recomputes every `path` from the chain of parents, and `type` from `parent_id`.
 *  4. Replaces the unique (user_id, path) index with a plain one, and makes live sibling names unique
 *     regardless of case. A folder can no longer be its own parent.
 *
 * `type` stays, derived ('collection' at the top level, else 'folder'), because the server that is replaced by
 * this deploy still reads it.
 *
 * down(): removes the constraint and the new indexes and restores the unique (user_id, path) index, or a plain
 * one when live paths repeat (possible once a live folder sits under a trashed one). Renames, paths and types
 * are not restored. Code from before this migration protects only the folders directly under a private folder.
 */

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const MAX_NAME_LENGTH = 255;

/** Every folder's path, built from the top level down. */
const FOLDER_PATHS = sql`
    WITH RECURSIVE tree AS (
        SELECT id, '/' || name AS path FROM folders WHERE parent_id IS NULL
        UNION ALL
        SELECT f.id, tree.path || '/' || f.name FROM folders f JOIN tree ON f.parent_id = tree.id
    )
`;

/** Live folders that share their name, regardless of case, with an older live sibling. */
const CLASHING_FOLDERS = sql`
    SELECT id, user_id, parent_id, name FROM (
        SELECT id, user_id, parent_id, name, created_at,
               row_number() OVER (PARTITION BY user_id, parent_id, lower(name) ORDER BY created_at, id) AS place
        FROM folders WHERE deleted_at IS NULL
    ) siblings
    WHERE place > 1
    ORDER BY created_at, id
`;

/** What the audit counts: each query returns one row per case. */
const AUDIT: [label: string, cases: RawBuilder<unknown>][] = [
    ['documents directly in a collection', sql`SELECT 1 FROM documents d JOIN folders f ON f.id = d.folder_id WHERE f.type = 'collection'`],
    ['documents at the top level', sql`SELECT 1 FROM documents WHERE folder_id IS NULL`],
    ["top-level folders of type 'folder'", sql`SELECT 1 FROM folders WHERE parent_id IS NULL AND type = 'folder'`],
    ["folder names containing '/'", sql`SELECT 1 FROM folders WHERE position('/' IN name) > 0`],
    ['live siblings with the same name regardless of case', CLASHING_FOLDERS],
    ['folders with a stale path', sql`${FOLDER_PATHS} SELECT 1 FROM folders f JOIN tree ON tree.id = f.id WHERE f.path <> tree.path`],
    [
        'private folders beneath a private folder',
        sql`
            WITH RECURSIVE beneath AS (
                SELECT id FROM folders WHERE parent_id IN (SELECT id FROM folders WHERE is_private)
                UNION
                SELECT f.id FROM folders f JOIN beneath ON f.parent_id = beneath.id
            )
            SELECT 1 FROM folders WHERE is_private AND id IN (SELECT id FROM beneath)
        `,
    ],
    [
        'live folders under a trashed parent',
        sql`SELECT 1 FROM folders f JOIN folders p ON p.id = f.parent_id WHERE f.deleted_at IS NULL AND p.deleted_at IS NOT NULL`,
    ],
    ['folders that are their own parent', sql`SELECT 1 FROM folders WHERE parent_id = id`],
];

async function logAudit(db: Kysely<unknown>): Promise<void> {
    for (const [label, cases] of AUDIT) {
        const { rows } = await sql<{ n: string }>`SELECT count(*) AS n FROM (${cases}) cases`.execute(db);

        console.log(`027 audit, ${label}: ${rows[0]!.n}`);
    }
}

interface ClashingFolder {
    id: string;
    user_id: string;
    parent_id: string | null;
    name: string;
}

async function isNameTaken(db: Kysely<unknown>, folder: ClashingFolder, name: string): Promise<boolean> {
    const { rows } = await sql`
        SELECT 1 FROM folders
        WHERE user_id = ${folder.user_id} AND parent_id IS NOT DISTINCT FROM ${folder.parent_id}::uuid
          AND deleted_at IS NULL AND id <> ${folder.id} AND lower(name) = lower(${name})
        LIMIT 1
    `.execute(db);

    return rows.length > 0;
}

async function findFreeName(db: Kysely<unknown>, folder: ClashingFolder): Promise<string> {
    for (let suffix = 2; ; suffix++) {
        const ending = ` (${suffix})`;
        const name = folder.name.slice(0, MAX_NAME_LENGTH - ending.length) + ending;

        if (!(await isNameTaken(db, folder, name))) return name;
    }
}

async function renameFolders(db: Kysely<unknown>): Promise<void> {
    await sql`UPDATE folders SET name = replace(name, '/', '-') WHERE position('/' IN name) > 0`.execute(db);

    const { rows } = await sql<ClashingFolder>`${CLASHING_FOLDERS}`.execute(db);

    for (const folder of rows) {
        const name = await findFreeName(db, folder);

        await sql`UPDATE folders SET name = ${name} WHERE id = ${folder.id}`.execute(db);
    }
}

export async function up(db: Kysely<unknown>): Promise<void> {
    await logAudit(db);

    // Dropped first: renaming and re-pathing may pass through states the old index refuses.
    await sql`DROP INDEX idx_folders_user_path`.execute(db);
    await renameFolders(db);
    await sql`${FOLDER_PATHS} UPDATE folders f SET path = tree.path FROM tree WHERE f.id = tree.id AND f.path <> tree.path`.execute(db);
    await sql`
        UPDATE folders SET type = CASE WHEN parent_id IS NULL THEN 'collection' ELSE 'folder' END
        WHERE type <> CASE WHEN parent_id IS NULL THEN 'collection' ELSE 'folder' END
    `.execute(db);

    await sql`CREATE INDEX idx_folders_user_path ON folders (user_id, path)`.execute(db);
    await sql`
        CREATE UNIQUE INDEX idx_folders_sibling_name
        ON folders (user_id, (coalesce(parent_id, ${sql.lit(NIL_UUID)}::uuid)), lower(name))
        WHERE deleted_at IS NULL
    `.execute(db);
    await sql`ALTER TABLE folders ADD CONSTRAINT folders_not_own_parent CHECK (parent_id <> id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE folders DROP CONSTRAINT folders_not_own_parent`.execute(db);
    await sql`DROP INDEX idx_folders_sibling_name`.execute(db);
    await sql`DROP INDEX idx_folders_user_path`.execute(db);

    const { rows } = await sql`
        SELECT 1 FROM folders WHERE deleted_at IS NULL GROUP BY user_id, path HAVING count(*) > 1 LIMIT 1
    `.execute(db);
    const unique = rows.length === 0;

    await sql`CREATE ${sql.raw(unique ? 'UNIQUE INDEX' : 'INDEX')} idx_folders_user_path ON folders (user_id, path) WHERE deleted_at IS NULL`.execute(db);

    if (!unique) console.log('027 down: live folder paths repeat, so idx_folders_user_path is not unique');

    console.log('027 down: renamed folders keep their new names');
    console.log('027 down: older code hides only what is directly under a private folder; anything nested deeper becomes visible');
}
