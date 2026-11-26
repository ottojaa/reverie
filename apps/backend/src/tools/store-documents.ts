import { db } from '../db/kysely';
import type { UploadedFile } from '../utils/upload-files';
import { recordWrite } from './audit';

/**
 * How a tool, or an upload link, adds documents: stored and processed exactly like a web upload,
 * then logged so undo_write can take them back. The upload and storage services are imported lazily
 * because they validate the server environment on import, which listing the tools must not need.
 */

export interface AddedDocument {
    id: string;
    name: string;
    /** The name the file arrived with, when the folder already had a document by that name. */
    renamed_from?: string;
}

/** Audit snapshot of added documents: where they were put, under which names. */
export interface AddedDocumentsState {
    /** null: the top level. */
    folder_id: string | null;
    documents: Array<{ id: string; name: string }>;
}

interface StoreRequest {
    userId: string;
    /** null: the top level. */
    folderId: string | null;
    files: UploadedFile[];
    /** The tool name and input the audit log records. */
    tool: string;
    auditInput: unknown;
}

/** Refuses, with a web upload's quota error, files that do not fit the user's quota together. */
export async function assertStorageRoom(userId: string, files: Array<Pick<UploadedFile, 'size'>>): Promise<void> {
    const { getStorageService } = await import('../services/storage.service.js');
    const storage = getStorageService();
    const total = files.reduce((sum, file) => sum + file.size, 0);

    storage.checkStorageQuota(await storage.getUserStorageContext(userId), total);
}

export async function storeDocuments(request: StoreRequest): Promise<{ documents: AddedDocument[]; auditId: string }> {
    const { userId, folderId, files } = request;
    const { getUploadService } = await import('../services/upload.service.js');
    const uploaded = await getUploadService().uploadFiles(files, userId, folderId ?? undefined, undefined, 'keep_both');
    const documents = uploaded.documents.map((doc, index): AddedDocument => {
        const sent = files[index]!.filename;
        const added = { id: doc.id, name: doc.original_filename };

        return added.name === sent ? added : { ...added, renamed_from: sent };
    });
    const after: AddedDocumentsState = { folder_id: folderId, documents: documents.map(({ id, name }) => ({ id, name })) };
    // Not in one transaction with the change: stored files and queued jobs could not roll back with it.
    const auditId = await recordWrite(db, { userId, tool: request.tool, input: request.auditInput, before: { documents: [] }, after });

    return { documents, auditId };
}
