import type { Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { PlannedWrite } from './write';
import type { Visibility } from './visibility';

/** The audit fields an undo reads. `before`/`after` are the snapshots the original write stored. */
export interface UndoEntry {
    id: string;
    input: unknown;
    before: unknown;
    after: unknown;
}

/**
 * Plans the reversal of one kind of write. It must refuse (throw a ToolError) unless the current
 * state still matches what the write left, and its `apply` must undo exactly what the write did.
 */
export type Undoer = (trx: Kysely<Database>, vis: Visibility, entry: UndoEntry) => Promise<PlannedWrite>;
