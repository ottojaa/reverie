import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { db } from '../db/kysely';
import type { Database } from '../db/schema';
import { recordWrite } from './audit';
import { loadSelection } from './selection.store';
import { ToolError, type ToolContext } from './types';
import { loadVisibility, type Visibility } from './visibility';

/**
 * Shared skeleton of the write tools. A tool plans its change inside a transaction (re-checking
 * every target for visibility and locking it), and the skeleton then either stops (dry run, or
 * nothing to change) or applies the change and writes the audit row in the same transaction.
 */

type DbOrTrx = Kysely<Database>;

export const MAX_WRITE_TARGETS = 1000;
export const PREVIEW_SAMPLE_SIZE = 10;

/** Input shared by every write tool. */
export const dryRunShape = {
    dry_run: z.boolean().default(false).describe('Report what would change without changing anything'),
};

/** Documents to act on: explicit ids, or the selection_id a search returned. Exactly one. */
export const documentTargetShape = {
    document_ids: z.array(z.string().uuid()).min(1).max(MAX_WRITE_TARGETS).optional().describe('Ids of the documents to act on'),
    selection_id: z.string().uuid().optional().describe('The selection_id returned by search_documents, to act on every match'),
};

export async function resolveDocumentIds(userId: string, input: { document_ids?: string[] | undefined; selection_id?: string | undefined }): Promise<string[]> {
    const hasIds = input.document_ids !== undefined;
    const hasSelection = input.selection_id !== undefined;

    if (hasIds === hasSelection) throw new ToolError('Pass exactly one of document_ids or selection_id');

    const ids = hasSelection ? await loadSelection(userId, input.selection_id!) : input.document_ids!;
    const unique = Array.from(new Set(ids));

    if (unique.length === 0) throw new ToolError('No documents to act on');

    if (unique.length > MAX_WRITE_TARGETS) {
        throw new ToolError('Too many documents (' + unique.length + '): narrow the search to at most ' + MAX_WRITE_TARGETS + ' per write');
    }

    return unique;
}

export interface PlannedWrite {
    /** What the agent is told: counts and a short sample, never the full list of targets. */
    preview: Record<string, unknown>;
    /** Number of rows the write would change; 0 means there is nothing to do. */
    changes: number;
    /** Audit snapshots, narrow enough to reverse the write and to detect later drift. */
    before: unknown;
    after: unknown;
    apply: (trx: DbOrTrx) => Promise<void>;
}

export interface WriteResult extends Record<string, unknown> {
    dry_run: boolean;
    applied: boolean;
    audit_id?: string;
}

interface RunWriteArgs {
    ctx: ToolContext;
    tool: string;
    input: unknown;
    dryRun: boolean;
    plan: (trx: DbOrTrx, vis: Visibility) => Promise<PlannedWrite>;
}

/** Thrown to roll back a dry run after it has exercised the real change. */
class DryRunRollback extends Error {
    constructor(readonly result: WriteResult) {
        super('Dry run rolled back');
    }
}

/**
 * A dry run performs the real change inside the transaction and rolls it back, so what it reports
 * (including a refusal) is exactly what applying would do, and it changes nothing by construction.
 */
export async function runWrite(args: RunWriteArgs): Promise<WriteResult> {
    const userId = args.ctx.user.id;
    const vis = await loadVisibility(userId);

    try {
        return await db.transaction().execute(async (trx) => {
            const planned = await args.plan(trx, vis);

            if (planned.changes === 0) return { dry_run: args.dryRun, applied: false, note: 'Nothing to change', ...planned.preview };

            await planned.apply(trx);

            if (args.dryRun) throw new DryRunRollback({ dry_run: true, applied: false, ...planned.preview });

            const auditId = await recordWrite(trx, { userId, tool: args.tool, input: args.input, before: planned.before, after: planned.after });

            return { dry_run: false, applied: true, audit_id: auditId, ...planned.preview };
        });
    } catch (error) {
        if (error instanceof DryRunRollback) return error.result;

        throw error;
    }
}

/** Rebuild the search vector of every touched document in one statement (tags and names are indexed). */
export async function rebuildSearchVectors(trx: DbOrTrx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await sql`SELECT rebuild_document_search_vector(id) FROM unnest(${ids}::uuid[]) AS id`.execute(trx);
}
