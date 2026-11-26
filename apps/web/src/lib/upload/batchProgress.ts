import type { UploadFile } from './types';

/** A file still counts while it is being sent or has arrived: not once it has failed, nor while it waits to be tried again. */
function isInBatch(file: UploadFile | undefined): file is UploadFile {
    return file !== undefined && file.status !== 'error' && file.status !== 'queued';
}

function toSentBytes(file: UploadFile): number {
    if (file.status !== 'uploading') return file.file.size;

    // The request being sent is slightly larger than the file in it.
    return Math.min(file.uploadLoaded ?? 0, file.file.size);
}

/** Bytes sent and to send of the latest batch of uploads. */
export function toBatchBytes(files: ReadonlyMap<string, UploadFile>, batchFileIds: string[]) {
    const batch = batchFileIds.map((id) => files.get(id)).filter(isInBatch);

    return {
        uploadBytesLoaded: batch.reduce((sum, file) => sum + toSentBytes(file), 0),
        uploadBytesTotal: batch.reduce((sum, file) => sum + file.file.size, 0),
    };
}
