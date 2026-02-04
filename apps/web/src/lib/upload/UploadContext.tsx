import type { Job, JobEvent } from '@reverie/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth';
import { connectSocket, onJobEvents, subscribeToDocument, subscribeToSession, unsubscribeFromDocument, unsubscribeFromSession } from '../socket';
import type { UploadFile, UploadSession, UploadState } from './types';
import { uploadFiles } from './uploadApi';

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
    | { type: 'START_UPLOAD' }
    | { type: 'UPLOAD_PROGRESS'; progress: number; loaded: number; total: number }
    | {
          type: 'UPLOAD_SUCCESS';
          sessionId: string;
          fileDocumentMap: Map<string, { documentId: string; jobs: Array<{ id: string }> }>; // key is file ID
      }
    | { type: 'UPLOAD_ERROR'; error: string }
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

    const completedJobs = updatedJobs.filter((j) => j.status === 'complete').length;
    const totalJobs = updatedJobs.length || 1;
    const processingProgress = Math.round((completedJobs / totalJobs) * 100);
    const allComplete = updatedJobs.every((j) => j.status === 'complete' || j.status === 'failed');

    return {
        ...file,
        jobs: updatedJobs,
        processingProgress: matchedJob ? (event.progress ?? processingProgress) : processingProgress,
        status: allComplete ? 'complete' : 'processing',
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
            const newFiles = new Map(state.files);
            for (const [id, file] of newFiles) {
                if (file.status === 'queued') {
                    newFiles.set(id, { ...file, status: 'uploading', uploadProgress: 0 });
                }
            }
            return {
                ...state,
                files: newFiles,
                isUploading: true,
                uploadBytesLoaded: 0,
                uploadBytesTotal: 0,
            };
        }

        case 'UPLOAD_PROGRESS': {
            const newFiles = new Map(state.files);
            for (const [id, file] of newFiles) {
                if (file.status === 'uploading') {
                    newFiles.set(id, { ...file, uploadProgress: action.progress });
                }
            }
            return {
                ...state,
                files: newFiles,
                uploadBytesLoaded: action.loaded,
                uploadBytesTotal: action.total,
            };
        }

        case 'UPLOAD_SUCCESS': {
            const newFiles = new Map(state.files);
            const fileIds: string[] = [];
            const pendingJobEvents = new Map(state.pendingJobEvents);

            for (const [id, file] of newFiles) {
                if (file.status === 'uploading') {
                    const mapping = action.fileDocumentMap.get(id); // Look up by file ID
                    if (mapping) {
                        const { error: _, ...fileRest } = file;
                        const jobs = mapping.jobs as Job[];
                        const hasJobs = jobs.length > 0;
                        let nextFile: UploadFile = {
                            ...fileRest,
                            status: hasJobs ? 'processing' : 'complete',
                            uploadProgress: 100,
                            processingProgress: hasJobs ? 0 : 100,
                            documentId: mapping.documentId,
                            jobs,
                        };

                        const pendingForDocument = pendingJobEvents.get(mapping.documentId);
                        if (pendingForDocument && pendingForDocument.size > 0) {
                            for (const pendingEvent of pendingForDocument.values()) {
                                nextFile = applyJobEventToFile(nextFile, pendingEvent);
                            }
                            pendingJobEvents.delete(mapping.documentId);
                        }

                        newFiles.set(id, nextFile);
                        fileIds.push(id);
                    }
                }
            }

            return {
                ...state,
                files: newFiles,
                pendingJobEvents,
                isUploading: false,
                session: {
                    sessionId: action.sessionId,
                    fileIds,
                    startedAt: new Date(),
                },
            };
        }

        case 'UPLOAD_ERROR': {
            const newFiles = new Map(state.files);
            for (const [id, file] of newFiles) {
                if (file.status === 'uploading') {
                    newFiles.set(id, {
                        ...file,
                        status: 'error',
                        error: action.error,
                    });
                }
            }
            return { ...state, files: newFiles, isUploading: false };
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
    /** Start uploading queued files */
    startUpload: (folderId?: string) => Promise<void>;
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
}

const UploadContext = createContext<UploadContextType | null>(null);

const noop = () => {};

export function UploadProvider({ children }: { children: ReactNode }) {
    const { accessToken } = useAuth();
    const [state, dispatch] = useReducer(uploadReducer, initialState);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const jobEventsCleanupRef = useRef<() => void>(noop);
    const sessionIdRef = useRef<string | null>(null);
    const subscribedDocumentIdsRef = useRef<Set<string>>(new Set());

    const openModal = useCallback(() => setIsModalOpen(true), []);
    const closeModal = useCallback(() => setIsModalOpen(false), []);

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
        async (folderId?: string) => {
            if (!accessToken) {
                throw new Error('Not authenticated');
            }

            const queuedFiles = Array.from(state.files.values()).filter((f) => f.status === 'queued');

            if (queuedFiles.length === 0) {
                return;
            }

            // Generate session ID and subscribe to WebSocket BEFORE upload so we don't miss job events
            const sessionId = crypto.randomUUID();
            jobEventsCleanupRef.current();
            if (sessionIdRef.current) {
                unsubscribeFromSession(sessionIdRef.current);
            }
            sessionIdRef.current = sessionId;
            connectSocket();
            subscribeToSession(sessionId);
            jobEventsCleanupRef.current = onJobEvents((event) => {
                dispatch({ type: 'JOB_EVENT', event });
            });

            dispatch({ type: 'START_UPLOAD' });

            try {
                const result = await uploadFiles(
                    queuedFiles.map((f) => f.file),
                    accessToken,
                    {
                        ...(folderId && { folderId }),
                        sessionId,
                        onProgress: (loaded, total) => {
                            const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
                            dispatch({ type: 'UPLOAD_PROGRESS', progress, loaded, total });
                        },
                    },
                );

                // Map file IDs to document IDs and jobs (using index-based correspondence)
                const fileDocumentMap = new Map<string, { documentId: string; jobs: Array<{ id: string }> }>();

                for (let i = 0; i < Math.min(result.documents.length, queuedFiles.length); i++) {
                    const doc = result.documents[i];
                    const queuedFile = queuedFiles[i];

                    if (!doc || !queuedFile) continue;

                    const docJobs = result.jobs.filter((j) => j.target_id === doc.id);

                    // Use queued file ID as key for reliable matching
                    fileDocumentMap.set(queuedFile.id, {
                        documentId: doc.id,
                        jobs: docJobs,
                    });
                }

                for (const doc of result.documents) {
                    if (!subscribedDocumentIdsRef.current.has(doc.id)) {
                        subscribeToDocument(doc.id);
                        subscribedDocumentIdsRef.current.add(doc.id);
                    }
                }

                dispatch({
                    type: 'UPLOAD_SUCCESS',
                    sessionId: result.session_id,
                    fileDocumentMap,
                });
            } catch (error) {
                dispatch({
                    type: 'UPLOAD_ERROR',
                    error: error instanceof Error ? error.message : 'Upload failed',
                });
            }
        },
        [accessToken, state.files],
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
