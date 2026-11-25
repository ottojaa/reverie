import { z } from 'zod';
import { lockAuditEntry, markUndone } from './audit';
import { saveTextDocument, undoAddDocuments, uploadLocalFiles } from './documents-add';
import { moveDocuments, renameDocument, undoMove, undoRenameDocument } from './documents-write';
import { createFolder, renameFolder, undoCreateFolder, undoRenameFolder } from './folders-write';
import { addTags, removeTags, undoAddTags, undoRemoveTags } from './tags';
import { defineTool, ToolError } from './types';
import type { Undoer } from './undo-types';
import { dryRunShape, runWrite } from './write';

/** The reversal of every write tool, keyed by the tool name stored in the audit log. */
const UNDOERS: Record<string, Undoer> = {
    [addTags.name]: undoAddTags,
    [removeTags.name]: undoRemoveTags,
    [moveDocuments.name]: undoMove,
    [createFolder.name]: undoCreateFolder,
    [renameFolder.name]: undoRenameFolder,
    [renameDocument.name]: undoRenameDocument,
    [uploadLocalFiles.name]: undoAddDocuments,
    [saveTextDocument.name]: undoAddDocuments,
};

const undoSchema = z.object({
    audit_id: z.string().uuid().describe('The audit_id a write tool returned'),
    ...dryRunShape,
});

export const undoWrite = defineTool({
    name: 'undo_write',
    description:
        'Reverse one applied write by its audit_id. Refuses, saying why, when the library no longer matches what the write left (moved again, renamed again, folder trashed). Writes made by undo_write cannot be undone: repeat the original write instead.',
    access: 'write',
    inputSchema: undoSchema,
    handler: (input, ctx) =>
        runWrite({
            ctx,
            tool: 'undo_write',
            input,
            dryRun: input.dry_run,
            plan: async (trx, vis) => {
                // The row lock makes two concurrent undos of one entry run one after the other.
                const entry = await lockAuditEntry(trx, vis.userId, input.audit_id);

                if (entry.undone_at) throw new ToolError('Already undone: ' + entry.id);

                const undoer = UNDOERS[entry.tool];

                if (!undoer) throw new ToolError('This write cannot be undone: ' + entry.tool);

                const planned = await undoer(trx, vis, { id: entry.id, input: entry.input, before: entry.state_before, after: entry.state_after });

                return {
                    ...planned,
                    preview: { undoes: entry.tool, undone_audit_id: entry.id, ...planned.preview },
                    apply: async (t) => {
                        await planned.apply(t);
                        await markUndone(t, entry.id);
                    },
                };
            },
        }),
});
