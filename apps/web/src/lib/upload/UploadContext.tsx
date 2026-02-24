import type { Job, JobEvent } from '@reverie/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { ensureSocketConnected, onJobEvents, subscribeToDocument, subscribeToSession, unsubscribeFromDocument, unsubscribeFromSession } from '../socket';
import type { UploadFile, UploadSession, UploadState } from './types';
import { uploadFile } from './uploadApi';

// Generate unique IDs for files
let fileIdCounter = 0;

function generateFileId(): string {
    return `file-${Date.now()}-${++fileIdCounter}`;
}

// Actions
type UploadAction =
    | { type: 'ADD_FILES'; files: File[] }
    | { type: 'REMOVE_FILE'; fileId: string }
    | { type: 'CLEAR_COMPLETED' }
    | { type: 'CLEAR_FAILED' }
    | { type: 'RETRY_FAILED' }
    | { type: 'RETRY_FILE'; fileId: string }
    | { type: 'START_UPLOAD'; totalBytes: number }
    | { type: 'START_FILE_UPLOAD'; fileId: string }
    | { type: 'UPLOAD_PROGRESS'; fileId: string; progress: number; loaded: number; total: number }
    | { type: 'FILE_UPLOAD_SUCCESS'; fileId: string; documentId: string; jobs: Array<{ id: string }> }
    | { type: 'UPLOAD_ERROR'; fileId: string; error: string }
    | { type: 'UPLOAD_FINISHED'; sessionId: string; fileIds: string[] }
    | { type: 'JOB_EVENT'; event: JobEvent }
    | { type: 'RESET' };

// Initial state
const initialState: UploadState = {
    files: new Map(),
    pendingJobEvents: new Map(),
    session: null,
    isUploading: false,
    uploadBytesLoaded: 0,
    uploadBytesTotal: 0,
};

function applyJobEventToFile(file: UploadFile, event: JobEvent): UploadFile {
    if (!file.jobs || file.jobs.length === 0) {
        return file;
    }

    let matchedJob = false;
    const updatedJobs = file.jobs.map((job) => {
        if (job.id !== event.job_id) {
            return job;
        }

        matchedJob = true;
        const isTerminalEvent = event.type === 'job:complete' || event.type === 'job:failed';
        const isTerminalStatus = job.status === 'complete' || job.status === 'failed';

        if (!isTerminalEvent && isTerminalStatus) {
            return job;
        }

        return { ...job, status: event.status };
    });

    // Only thumbnail jobs gate upload modal completion — OCR/LLM run in background
    const thumbnailJobs = updatedJobs.filter((j) => j.job_type === 'thumbnail');
    const allThumbnailsDone = thumbnailJobs.length === 0 || thumbnailJobs.every((j) => j.status === 'complete' || j.status === 'failed');

    const completedThumbnails = thumbnailJobs.filter((j) => j.status === 'complete' || j.status === 'failed').length;
    const thumbnailProgress = thumbnailJobs.length > 0 ? Math.round((completedThumbnails / thumbnailJobs.length) * 100) : 100;

    // Use event.progress only for thumbnail job events
    const matchedJobType = matchedJob ? updatedJobs.find((j) => j.id === event.job_id)?.job_type : undefined;
    const processingProgress = matchedJobType === 'thumbnail' && event.progress != null ? event.progress : thumbnailProgress;

    return {
        ...file,
        jobs: updatedJobs,
        processingProgress,
        status: allThumbnailsDone ? 'complete' : 'processing',
    };
}

// Reducer
function uploadReducer(state: UploadState, action: UploadAction): UploadState {
    switch (action.type) {
        case 'ADD_FILES': {
            const newFiles = new Map(state.files);

            for (const file of action.files) {
                const id = generateFileId();
                newFiles.set(id, {
                    id,
                    file,
                    status: 'queued',
                    uploadProgress: 0,
                    processingProgress: 0,
                });
            }

            return { ...state, files: newFiles };
        }

        case 'REMOVE_FILE': {
            const newFiles = new Map(state.files);
            newFiles.delete(action.fileId);

            return { ...state, files: newFiles };
        }

        case 'CLEAR_COMPLETED': {
            const newFiles = new Map(state.files);

            for (const [id, file] of newFiles) {
                if (file.status === 'complete') {
                    newFiles.delete(id);
                }
            }

            return { ...state, files: newFiles };
        }

        case 'CLEAR_FAILED': {
            const newFiles = new Map(state.files);

            for (const [id, file] of newFiles) {
                if (file.status === 'error') {
                    newFiles.delete(id);
                }
            }

            return { ...state, files: newFiles };
        }

        case 'RETRY_FAILED': {
            const newFiles = new Map(state.files);

            for (const [id, file] of newFiles) {
                if (file.status === 'error') {
                    const { error: _, ...rest } = file;
                    newFiles.set(id, {
                        ...rest,
                        status: 'queued',
                        uploadProgress: 0,
                    });
                }
            }

            return { ...state, files: newFiles };
        }

        case 'RETRY_FILE': {
            const newFiles = new Map(state.files);
            const file = newFiles.get(action.fileId);

            if (file && file.status === 'error') {
                newFiles.set(action.fileId, {
                    ...file,
                    status: 'queued',
                    uploadProgress: 0,
                });
            }

            return { ...state, files: newFiles };
        }

        case 'START_UPLOAD': {
            return {
                ...state,
                isUploading: true,
                uploadBytesLoaded: 0,
                uploadBytesTotal: action.totalBytes,
            };
        }

        case 'START_FILE_UPLOAD': {
            const newFiles = new Map(state.files);
            const file = newFiles.get(action.fileId);

            if (file && file.status === 'queued') {
                newFiles.set(action.fileId, { ...file, status: 'uploading', uploadProgress: 0 });
            }

            return { ...state, files: newFiles };
        }

        case 'UPLOAD_PROGRESS': {
            const newFiles = new Map(state.files);
            const file = newFiles.get(action.fileId);

            if (file && file.status === 'uploading') {
                newFiles.set(action.fileId, { ...file, uploadProgress: action.progress, uploadLoaded: action.loaded });
            }

            // Aggregate: sum of completed/processing file sizes + sum of loaded for all uploading files
            const completedBytes = Array.from(newFiles.values()).reduce(
                (sum, f) => (f.status === 'complete' || f.status === 'processing' ? sum + f.file.size : sum),
                0,
            );
            const uploadingBytes = Array.from(newFiles.values()).reduce((sum, f) => sum + (f.status === 'uploading' ? (f.uploadLoaded ?? 0) : 0), 0);
            const uploadBytesLoaded = completedBytes + uploadingBytes;

            return {
                ...state,
                files: newFiles,
                uploadBytesLoaded,
            };
        }

        case 'FILE_UPLOAD_SUCCESS': {
            const newFiles = new Map(state.files);
            const pendingJobEvents = new Map(state.pendingJobEvents);
            const file = newFiles.get(action.fileId);

            if (file && file.status === 'uploading') {
                const { error: _, ...fileRest } = file;
                const jobs = action.jobs as Job[];
                const hasThumbnailJobs = jobs.some((j) => j.job_type === 'thumbnail');
                let nextFile: UploadFile = {
                    ...fileRest,
                    status: hasThumbnailJobs ? 'processing' : 'complete',
                    uploadProgress: 100,
                    processingProgress: hasThumbnailJobs ? 0 : 100,
                    documentId: action.documentId,
                    jobs,
                };

                const pendingForDocument = pendingJobEvents.get(action.documentId);

                if (pendingForDocument && pendingForDocument.size > 0) {
                    for (const pendingEvent of pendingForDocument.values()) {
                        nextFile = applyJobEventToFile(nextFile, pendingEvent);
                    }

                    pendingJobEvents.delete(action.documentId);
                }

                newFiles.set(action.fileId, nextFile);
            }

            return { ...state, files: newFiles, pendingJobEvents };
        }

        case 'UPLOAD_ERROR': {
            const newFiles = new Map(state.files);
            const file = newFiles.get(action.fileId);

            if (file && file.status === 'uploading') {
                newFiles.set(action.fileId, { ...file, status: 'error', error: action.error });
            }

            return { ...state, files: newFiles };
        }

        case 'UPLOAD_FINISHED': {
            return {
                ...state,
                isUploading: false,
                session: {
                    sessionId: action.sessionId,
                    fileIds: action.fileIds,
                    startedAt: new Date(),
                },
            };
        }

        case 'JOB_EVENT': {
            const { event } = action;
            const newFiles = new Map(state.files);
            const pendingJobEvents = new Map(state.pendingJobEvents);
            let handled = false;

            // Find file by document ID
            for (const [id, file] of newFiles) {
                if (file.documentId === event.document_id) {
                    newFiles.set(id, applyJobEventToFile(file, event));
                    handled = true;
                    break;
                }
            }

            if (!handled && event.document_id) {
                const existing = pendingJobEvents.get(event.document_id) ?? new Map<string, JobEvent>();
                existing.set(event.job_id, event);
                pendingJobEvents.set(event.document_id, existing);
            }

            return { ...state, files: newFiles, pendingJobEvents };
        }

        case 'RESET':
            return initialState;

        default:
            return state;
    }
}

// Context
interface UploadContextType {
    /** All files in the upload queue */
    files: UploadFile[];
    /** Whether an upload is currently in progress */
    isUploading: boolean;
    /** Current session info */
    session: UploadSession | null;
    /** Whether the upload modal is open */
    isModalOpen: boolean;
    /** Open the upload modal */
    openModal: () => void;
    /** Close the upload modal */
    closeModal: () => void;
    /** Add files to the upload queue */
    addFiles: (files: File[]) => void;
    /** Remove a file from the queue */
    removeFile: (fileId: string) => void;
    /** Clear completed files */
    clearCompleted: () => void;
    /** Clear failed files */
    clearFailed: () => void;
    /** Retry all failed files */
    retryFailed: () => void;
    /** Retry a specific file */
    retryFile: (fileId: string) => void;
    /** Start uploading queued files (optionally with conflict strategy when duplicates were detected) */
    startUpload: (folderId?: string, conflictStrategy?: 'replace' | 'keep_both') => Promise<void>;
    /** Reset all state */
    reset: () => void;
    /** Computed stats */
    stats: {
        total: number;
        queued: number;
        uploading: number;
        processing: number;
        complete: number;
        error: number;
    };
    /** Byte-level upload progress (for phase indicator and smooth progress bar) */
    uploadBytesLoaded: number;
    uploadBytesTotal: number;
    /** Document IDs that just completed upload – shown with pulse in grid until dismissed */
    recentlyCompletedDocumentIds: string[];
    /** Record document IDs when upload completes (called from modal) */
    recordCompletedDocumentIds: (ids: string[]) => void;
    /** Mark pulse as seen for a document (removes from set) */
    markPulseComplete: (id: string) => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

const noop = () => {};

export function UploadProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(uploadReducer, initialState);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const jobEventsCleanupRef = useRef<() => void>(noop);
    const sessionIdRef = useRef<string | null>(null);
    const subscribedDocumentIdsRef = useRef<Set<string>>(new Set());

    const [recentlyCompletedDocumentIds, setRecentlyCompletedDocumentIds] = useState<string[]>([]);

    const openModal = useCallback(() => setIsModalOpen(true), []);
    const closeModal = useCallback(() => setIsModalOpen(false), []);

    const recordCompletedDocumentIds = useCallback((ids: string[]) => {
        setRecentlyCompletedDocumentIds(ids);
    }, []);

    const markPulseComplete = useCallback((id: string) => {
        console.log('markPulseComplete', id);
        setRecentlyCompletedDocumentIds((prev) => prev.filter((x) => x !== id));
    }, []);

    const addFiles = useCallback((files: File[]) => {
        if (files.length === 0) return;

        dispatch({ type: 'ADD_FILES', files });
        setIsModalOpen(true);
    }, []);

    const removeFile = useCallback((fileId: string) => {
        dispatch({ type: 'REMOVE_FILE', fileId });
    }, []);

    const clearCompleted = useCallback(() => {
        dispatch({ type: 'CLEAR_COMPLETED' });
    }, []);

    const clearFailed = useCallback(() => {
        dispatch({ type: 'CLEAR_FAILED' });
    }, []);

    const retryFailed = useCallback(() => {
        dispatch({ type: 'RETRY_FAILED' });
    }, []);

    const retryFile = useCallback((fileId: string) => {
        dispatch({ type: 'RETRY_FILE', fileId });
    }, []);

    const reset = useCallback(() => {
        jobEventsCleanupRef.current();

        if (sessionIdRef.current) {
            unsubscribeFromSession(sessionIdRef.current);
            sessionIdRef.current = null;
        }

        for (const documentId of subscribedDocumentIdsRef.current) {
            unsubscribeFromDocument(documentId);
        }

        subscribedDocumentIdsRef.current.clear();
        dispatch({ type: 'RESET' });
    }, []);

    const startUpload = useCallback(
        async (folderId?: string, conflictStrategy?: 'replace' | 'keep_both') => {
            const queuedFiles = Array.from(state.files.values()).filter((f) => f.status === 'queued');

            if (queuedFiles.length === 0) {
                return;
            }

            // Generate session ID and subscribe to WebSocket BEFORE upload so we don't miss job events.
            const sessionId = crypto.randomUUID();
            jobEventsCleanupRef.current();

            if (sessionIdRef.current) {
                unsubscribeFromSession(sessionIdRef.current);
            }

            sessionIdRef.current = sessionId;

            try {
                await ensureSocketConnected();
            } catch (err) {
                throw new Error(err instanceof Error ? err.message : 'WebSocket connection failed');
            }

            subscribeToSession(sessionId);
            jobEventsCleanupRef.current = onJobEvents((event) => {
                dispatch({ type: 'JOB_EVENT', event });
            });

            const totalBytes = queuedFiles.reduce((sum, f) => sum + f.file.size, 0);
            dispatch({ type: 'START_UPLOAD', totalBytes });

            // Mark all as uploading and start all uploads in parallel
            for (const queuedFile of queuedFiles) {
                dispatch({ type: 'START_FILE_UPLOAD', fileId: queuedFile.id });
            }

            const completedFileIds: string[] = [];

            await Promise.all(
                queuedFiles.map(async (queuedFile) => {
                    try {
                        const result = await uploadFile(queuedFile.file, {
                            sessionId,
                            ...(folderId && { folderId }),
                            ...(conflictStrategy && { conflictStrategy }),
                            onProgress: (loaded, total) => {
                                const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
                                dispatch({ type: 'UPLOAD_PROGRESS', fileId: queuedFile.id, progress, loaded, total });
                            },
                        });

                        const doc = result.documents[0];
                        const docJobs = result.jobs.filter((j) => doc && j.target_id === doc.id);

                        if (doc) {
                            if (!subscribedDocumentIdsRef.current.has(doc.id)) {
                                subscribeToDocument(doc.id);
                                subscribedDocumentIdsRef.current.add(doc.id);
                            }

                            dispatch({
                                type: 'FILE_UPLOAD_SUCCESS',
                                fileId: queuedFile.id,
                                documentId: doc.id,
                                jobs: docJobs,
                            });
                            completedFileIds.push(queuedFile.id);
                        }
                    } catch (error) {
                        dispatch({
                            type: 'UPLOAD_ERROR',
                            fileId: queuedFile.id,
                            error: error instanceof Error ? error.message : 'Upload failed',
                        });
                    }
                }),
            );

            dispatch({ type: 'UPLOAD_FINISHED', sessionId, fileIds: completedFileIds });
        },
        [state.files],
    );

    const files = useMemo(() => Array.from(state.files.values()), [state.files]);

    useEffect(() => {
        for (const file of files) {
            if (!file.documentId) continue;

            if (file.status !== 'complete' && file.status !== 'error') continue;

            if (!subscribedDocumentIdsRef.current.has(file.documentId)) continue;

            unsubscribeFromDocument(file.documentId);
            subscribedDocumentIdsRef.current.delete(file.documentId);
        }
    }, [files]);

    const stats = useMemo(() => {
        const counts = {
            total: files.length,
            queued: 0,
            uploading: 0,
            processing: 0,
            complete: 0,
            error: 0,
        };

        for (const file of files) {
            counts[file.status]++;
        }

        return counts;
    }, [files]);

    const value: UploadContextType = {
        files,
        isUploading: state.isUploading,
        session: state.session,
        isModalOpen,
        openModal,
        closeModal,
        addFiles,
        removeFile,
        clearCompleted,
        clearFailed,
        retryFailed,
        retryFile,
        startUpload,
        reset,
        stats,
        uploadBytesLoaded: state.uploadBytesLoaded,
        uploadBytesTotal: state.uploadBytesTotal,
        recentlyCompletedDocumentIds,
        recordCompletedDocumentIds,
        markPulseComplete,
    };

    return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload(): UploadContextType {
    const context = useContext(UploadContext);

    if (!context) {
        throw new Error('useUpload must be used within an UploadProvider');
    }

    return context;
}
