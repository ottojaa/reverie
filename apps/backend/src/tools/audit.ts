import type { Kysely } from 'kysely';
import type { Database, ToolAuditLogEntry } from '../db/schema';
import { ToolError } from './types';

/**
 * Audit log of applied writes. Each write inserts its row in the same transaction as the change,
 * so a change is never unlogged. `state_before` / `state_after` are per-tool snapshots narrow
 * enough to reverse the write and to tell whether the world still matches what it left.
 */

type DbOrTrx = Kysely<Database>;

export interface AuditRecord {
    userId: string;
    tool: string;
    input: unknown;
    before: unknown;
    after: unknown;
}

/** Insert an audit row and return its id. */
export async function recordWrite(trx: DbOrTrx, record: AuditRecord): Promise<string> {
    const row = await trx
        .insertInto('tool_audit_log')
        .values({
            user_id: record.userId,
            tool: record.tool,
            input: JSON.stringify(record.input),
            state_before: JSON.stringify(record.before),
            state_after: JSON.stringify(record.after),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    return row.id;
}

/** Lock one of the user's audit rows. Unknown and foreign ids read the same. */
export async function lockAuditEntry(trx: DbOrTrx, userId: string, auditId: string): Promise<ToolAuditLogEntry> {
    const entry = await trx.selectFrom('tool_audit_log').selectAll().where('id', '=', auditId).where('user_id', '=', userId).forUpdate().executeTakeFirst();

    if (!entry) throw new ToolError('Audit entry not found: ' + auditId);

    return entry;
}

export async function markUndone(trx: DbOrTrx, auditId: string): Promise<void> {
    await trx.updateTable('tool_audit_log').set({ undone_at: new Date() }).where('id', '=', auditId).execute();
}
