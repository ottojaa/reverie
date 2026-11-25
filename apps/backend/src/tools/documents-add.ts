import { StorageError } from '@reverie/shared';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { db } from '../db/kysely';
import { assertStorageRoom, storeDocuments, type AddedDocumentsState } from './store-documents';
import { defineTool, ToolError } from './types';
import type { Undoer } from './undo-types';
import { toUploadCommand } from './upload-command';
import { createUploadLink } from './upload-link.store';
import { assertDocumentFolder, assertVisibleDocuments, loadVisibility, type VisibleDocument } from './visibility';
import { dryRunShape, PREVIEW_SAMPLE_SIZE } from './write';

/** upload_local_files / save_text_document, the two ways to add documents, and the undo of both. */

const MAX_UPLOAD_PATHS = 50;
const MAX_TEXT_BYTES = 256 * 1024;
const TEXT_EXTENSIONS = ['.md', '.txt', '.csv', '.json'];
const FORBIDDEN_NAME = /[/\\\0]/;
// A backslash is refused because the server would cut the stored filename at it.
const UNSUPPORTED_IN_PATH = /[*?\\\p{Cc}]/u;

function isLocalFilePath(path: string): boolean {
    if (!path.startsWith('/') && !path.startsWith('~/')) return false;

    return !path.endsWith('/') && !UNSUPPORTED_IN_PATH.test(path);
}

async function fetchTargetFolder(userId: string, folderId: string): Promise<{ id: string; path: string }> {
    const folder = await assertDocumentFolder(db, await loadVisibility(userId), folderId);

    return { id: folder.id, path: folder.path };
}

const folderIdSchema = z.string().uuid().describe('The folder to add to (not a collection)');

const uploadSchema = z.object({
    folder_id: folderIdSchema,
    paths: z
        .array(
            z.string().max(4096).refine(isLocalFilePath, 'must be absolute or start with ~/, name one file, and contain no * ? backslash or control character'),
        )
        .min(1)
        .max(MAX_UPLOAD_PATHS)
        .describe('Paths of the files on the computer that will run the command'),
    ...dryRunShape,
});

export const uploadLocalFiles = defineTool({
    name: 'upload_local_files',
    description:
        'Add files from the computer you are working on to a folder. Returns a curl command (curl 7.81 or newer) that you must run in a shell on the machine that has the files, so this works only for a client with a shell, such as Claude Code. Without a shell, use save_text_document for text you write yourself. Nothing is added until the command runs; it works once, within 15 minutes.',
    access: 'write',
    inputSchema: uploadSchema,
    handler: async (input, ctx) => {
        const folder = await fetchTargetFolder(ctx.user.id, input.folder_id);

        if (input.dry_run) return { dry_run: true, applied: false, folder, files: input.paths.length };

        if (!ctx.publicBaseUrl) throw new ToolError('The server does not know its public address: the owner has to set API_PUBLIC_URL');

        const { secret, expiresAt } = await createUploadLink({ userId: ctx.user.id, folderId: folder.id });

        return {
            command: toUploadCommand({ url: ctx.publicBaseUrl + '/mcp/upload', secret, paths: input.paths }),
            folder,
            files: input.paths.length,
            expires_at: expiresAt.toISOString(),
            next_step:
                'Run the command as it is, in a shell on the computer that has the files, before expires_at. It works once, even if it fails: call this tool again for a new one. Its answer lists the new documents and the audit_id that undo_write takes.',
        };
    },
});

const saveTextSchema = z.object({
    folder_id: folderIdSchema,
    name: z.string().trim().min(1).max(255).describe('Filename without slashes: .md, .txt, .csv or .json; .md is added when there is no extension'),
    content: z.string().describe('The text of the document, at most 256 KiB as UTF-8'),
    ...dryRunShape,
});

function toTextFileName(name: string): string {
    if (FORBIDDEN_NAME.test(name)) throw new ToolError('Invalid document name: it cannot contain slashes');

    const extension = extname(name).toLowerCase();

    if (!extension) return name + '.md';

    if (!TEXT_EXTENSIONS.includes(extension)) throw new ToolError('Unsupported extension, use .md, .txt, .csv or .json: ' + extension);

    return name;
}

function toTextBytes(content: string): Buffer {
    const bytes = Buffer.byteLength(content, 'utf8');

    if (bytes > MAX_TEXT_BYTES)
        throw new ToolError('Content is too large, the limit is 256 KiB (' + MAX_TEXT_BYTES + ' bytes of UTF-8): got ' + bytes + ' bytes');

    return Buffer.from(content, 'utf8');
}

function toQuotaRefusal(error: unknown): never {
    if (error instanceof StorageError) throw new ToolError(error.message);

    throw error;
}

async function storeText(userId: string, folderId: string, name: string, content: Buffer) {
    // Loaded lazily, like the services behind storeDocuments: it reads the server environment on import.
    const { receiveUploadedFile, discardUploadedFiles } = await import('../utils/upload-files.js');
    // No type named: the upload takes it from the extension.
    const file = await receiveUploadedFile({ file: Readable.from([content]), filename: name, mimetype: 'application/octet-stream' });

    try {
        await assertStorageRoom(userId, [file]).catch(toQuotaRefusal);

        // The log keeps the size, not the text: the document holds the text, and purging it should remove it.
        const auditInput = { folder_id: folderId, name, bytes: file.size };

        return await storeDocuments({ userId, folderId, files: [file], tool: 'save_text_document', auditInput });
    } finally {
        await discardUploadedFiles([file]);
    }
}

export const saveTextDocument = defineTool({
    name: 'save_text_document',
    description:
        'Save text you wrote (a note, summary, table or JSON) as a new document in a folder. It is processed like an upload (.md, .txt and .csv become searchable by content), never overwrites (a taken name gets " (1)"), and undo_write moves it to the trash. For files that already exist on disk, use upload_local_files.',
    access: 'write',
    inputSchema: saveTextSchema,
    handler: async (input, ctx) => {
        const folder = await fetchTargetFolder(ctx.user.id, input.folder_id);
        const name = toTextFileName(input.name);
        const content = toTextBytes(input.content);

        if (input.dry_run) return { applied: false, dry_run: true, document: { name, folder } };

        const { documents, auditId } = await storeText(ctx.user.id, folder.id, name, content);
        const { renamed_from, ...added } = documents[0]!;

        return {
            applied: true,
            dry_run: false,
            document: { ...added, folder },
            ...(renamed_from ? { renamed_from } : {}),
            audit_id: auditId,
        };
    },
});

function assertAsAdded(documents: VisibleDocument[], added: AddedDocumentsState): void {
    const names = new Map(added.documents.map((doc) => [doc.id, doc.name]));
    const changed = documents.filter((doc) => doc.folder_id !== added.folder_id || doc.original_filename !== names.get(doc.id));

    if (changed.length === 0) return;

    throw new ToolError(
        'Cannot undo: ' + changed.length + ' document(s) have been moved or renamed since they were added (e.g. ' + changed[0]!.original_filename + ')',
    );
}

/** Moves the added documents to the trash, if each is still where and what it was added as. */
export const undoAddDocuments: Undoer = async (trx, vis, entry) => {
    const added = entry.after as AddedDocumentsState;
    const ids = added.documents.map((doc) => doc.id);
    const documents = await assertVisibleDocuments(trx, vis, ids);

    assertAsAdded(documents, added);

    return {
        preview: {
            documents_trashed: documents.length,
            sample: documents.slice(0, PREVIEW_SAMPLE_SIZE).map((doc) => ({ id: doc.id, filename: doc.original_filename })),
        },
        changes: documents.length,
        before: added,
        after: { documents: [] },
        apply: async (t) => {
            await t.updateTable('documents').set({ deleted_at: new Date() }).where('id', 'in', ids).execute();
        },
    };
};
